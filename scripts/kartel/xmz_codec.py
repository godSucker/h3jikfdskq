import zlib, sys

# ---- alphabet (same as decoder) ----
def build_alphabet():
    m = {}
    m['7']=0; m['8']=1; m['9']=2; m['+']=3; m['-']=4
    for i in range(26):
        m[chr(ord('a')+i)] = 5+i
    for i in range(26):
        m[chr(ord('A')+i)] = 31+i
    for i in range(7):
        m[chr(ord('0')+i)] = 57+i
    return m

ALPHA = build_alphabet()
INV_ALPHA = {v: k for k, v in ALPHA.items()}
assert len(ALPHA) == 64

# ---- reference decoder (unchanged, for round-trip verification) ----
def decode(raw):
    first = raw[0]
    c = chr(first)
    if c not in ALPHA:
        return None, f"first byte {first:#x} not in alphabet"
    state = ALPHA[c]
    body = raw[1:]
    if len(body) % 2 != 0:
        return None, "body length odd -> bail"
    num_pairs = len(body)//2
    parity_flag = state & 1
    out = bytearray()
    for i in range(num_pairs):
        b0 = body[2*i]; b1 = body[2*i+1]
        combined = b0 | (b1<<8)
        if combined < state:
            combined += 0x10000
        delta = (combined - state) & 0xFFFFFFFF
        out.append((delta >> 8) & 0xFF)
        loop_count = i+1
        skip_low = (loop_count == num_pairs) and (parity_flag == 1)
        if not skip_low:
            out.append(delta & 0xFF)
        t = (loop_count + delta) * 13 + state - 13
        state = t % 9999
    return bytes(out), "ok"


def encode_xmz(plaintext: bytes, first_char: str = None, last_low_byte: int = 0,
               marker: bytes = b'~') -> bytes:
    """
    Inverse of decode(). Returns marker + first_char + encoded pair-bytes,
    such that decode(result[1:]) == plaintext.

    first_char: which alphabet character to use as the state seed. Its parity
                (ALPHA[first_char] & 1) MUST match len(plaintext) & 1, since
                that parity determines whether the final pair drops its low
                byte (odd-length payloads) or not (even-length payloads).
                If not given, a valid default is picked automatically.
    last_low_byte: when the payload length is odd, the final input pair's
                low byte is never recoverable from decode() (it's discarded
                by skip_low), so its value is free -- default 0. Any other
                value would round-trip identically; only matters if you're
                trying to bit-for-bit reproduce a specific captured sample.
    """
    L = len(plaintext)
    need_parity = L & 1

    if first_char is None:
        # pick smallest state with matching parity, deterministically
        for state in range(64):
            if state & 1 == need_parity:
                first_char = INV_ALPHA[state]
                break
    else:
        if first_char not in ALPHA:
            raise ValueError(f"{first_char!r} not in alphabet")
        if ALPHA[first_char] & 1 != need_parity:
            raise ValueError(
                f"first_char {first_char!r} has wrong parity "
                f"(state parity {ALPHA[first_char]&1}, need {need_parity}) "
                f"for plaintext length {L}"
            )

    state = ALPHA[first_char]
    parity_flag = state & 1
    num_pairs = (L + 1)//2 if parity_flag == 1 else L//2
    # sanity: output length decode() would produce
    expected_out_len = 2*num_pairs - (1 if parity_flag == 1 else 0)
    assert expected_out_len == L, (expected_out_len, L)

    out_pairs = bytearray()
    ptr = 0
    for i in range(num_pairs):
        loop_count = i + 1
        is_last = (i == num_pairs - 1)
        skip_low = is_last and parity_flag == 1

        high_byte = plaintext[ptr]; ptr += 1
        if skip_low:
            low_byte = last_low_byte & 0xFF
        else:
            low_byte = plaintext[ptr]; ptr += 1

        delta = ((high_byte << 8) | low_byte) & 0xFFFF
        combined = (state + delta) & 0xFFFF
        b0 = combined & 0xFF          # low byte of combined, written first
        b1 = (combined >> 8) & 0xFF   # high byte of combined, written second
        out_pairs.append(b0)
        out_pairs.append(b1)

        t = (loop_count + delta) * 13 + state - 13
        state = t % 9999

    assert ptr == L
    return marker + first_char.encode('ascii') + bytes(out_pairs)


if __name__ == '__main__':
    # ---- 1. basic round trip test on arbitrary data ----
    import os
    for test_len in [0, 1, 2, 3, 10, 11, 100, 101, 255, 256]:
        pt = os.urandom(test_len)
        enc = encode_xmz(pt)
        dec, status = decode(enc[1:])
        assert status == 'ok', status
        assert dec == pt, (test_len, dec, pt)
    print("round-trip random tests: PASS")

    # ---- 2. round trip on real captured plaintext ----
    # (the payload turns out to be plain JSON -- no zlib layer involved;
    #  the try/except zlib block in the original decoder was just a fallback
    #  probe that never actually fires for these samples)
    for fname in ['body_3.bin', 'body_4.bin', 'body_7.bin']:
        data = open(fname, 'rb').read()
        assert data[0] == 0x63 and data[1] == 0x00 and data[2] in (0x24, 0x7e)
        marker = data[2:3]
        raw = data[3:]
        plaintext, status = decode(raw)
        assert status == 'ok'
        print(f"{fname}: decoded {len(plaintext)}B JSON, starts: {plaintext[:40]!r}")

        # 2a. plain encode/decode round trip
        re_enc = encode_xmz(plaintext, marker=marker)
        re_dec, st = decode(re_enc[1:])
        assert st == 'ok'
        assert re_dec == plaintext
        print(f"{fname}: encode->decode round-trip matches original plaintext: PASS")

        # 2b. exact byte-for-byte reproduction using SAME plaintext bytes
        #     and SAME first_char as the captured sample
        first_char = chr(raw[0])
        exact_enc = encode_xmz(plaintext, first_char=first_char, marker=marker)
        full_exact = b'\x63\x00' + exact_enc
        if full_exact == data:
            print(f"{fname}: EXACT byte-for-byte match with captured sample: PASS")
        else:
            # try all 256 possibilities for the discarded last low byte, if applicable
            match = None
            for lb in range(256):
                cand = encode_xmz(plaintext, first_char=first_char, last_low_byte=lb, marker=marker)
                if b'\x63\x00' + cand == data:
                    match = lb
                    break
            if match is not None:
                print(f"{fname}: EXACT match found with last_low_byte={match}: PASS")
            else:
                print(f"{fname}: no exact byte match "
                      f"(lengths: mine={len(full_exact)} theirs={len(data)}) -- "
                      f"decode-equivalence still holds")
