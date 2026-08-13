#!/usr/bin/env python3
"""AI upscaling using Real-ESRGAN ONNX with CUDA acceleration."""
import os, sys, glob, time, argparse
import numpy as np
import onnxruntime as ort
from PIL import Image

MODEL_URL = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-x4plus.onnx"
MODEL_PATH = "/tmp/realesrgan-x4plus.onnx"

def download_model():
    if os.path.exists(MODEL_PATH) and os.path.getsize(MODEL_PATH) > 1000:
        return
    import urllib.request
    print(f"Downloading model...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print(f"Downloaded: {os.path.getsize(MODEL_PATH)//1024}KB")

def create_session():
    providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(MODEL_PATH, opts, providers=providers)

def preprocess(img: Image.Image) -> np.ndarray:
    arr = np.array(img).astype(np.float32) / 255.0
    if arr.ndim == 2:
        arr = np.stack([arr]*3, axis=-1)
    if arr.shape[2] == 4:
        arr = arr[:, :, :3]  # drop alpha for model
    arr = arr.transpose(2, 0, 1)  # CHW
    return arr[np.newaxis, ...]  # BCHW

def postprocess(output: np.ndarray, has_alpha: bool, orig_alpha: np.ndarray = None) -> Image.Image:
    output = output[0].transpose(1, 2, 0)  # HWC
    output = np.clip(output * 255, 0, 255).astype(np.uint8)
    if has_alpha and orig_alpha is not None:
        alpha = orig_alpha.resize((output.shape[1], output.shape[0]), Image.BICUBIC)
        alpha_arr = np.array(alpha)
        output = np.dstack([output, alpha_arr])
    return Image.fromarray(output)

def upscale_image(session, src_path: str, target_size: int = 400) -> Image.Image:
    img = Image.open(src_path).convert("RGBA")
    orig_alpha = img.split()[3]
    
    # Pad to 100x100 (for x4 = 400)
    pad_size = target_size // 4
    padded = Image.new("RGBA", (pad_size, pad_size), (0, 0, 0, 0))
    offset = ((pad_size - img.width) // 2, (pad_size - img.height) // 2)
    padded.paste(img, offset)
    
    # Run model
    inp = preprocess(padded)
    out = session.run(None, {"input": inp})[0]
    
    # Postprocess
    result = postprocess(out, True, orig_alpha)
    return result.resize((target_size, target_size), Image.BICUBIC)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="public/textures_by_mutant")
    parser.add_argument("--output", default=None)
    parser.add_argument("--size", type=int, default=400)
    parser.add_argument("--quality", type=int, default=95)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    
    source_dir = args.source
    output_dir = args.output or source_dir
    
    download_model()
    session = create_session()
    print(f"Model loaded. GPU: {session.get_providers()[0]}")
    
    # Find specimens
    specs = []
    for root, dirs, files in os.walk(source_dir):
        for f in files:
            if f.startswith("specimen_") and f.endswith(".webp"):
                specs.append(os.path.join(root, f))
    specs.sort()
    
    print(f"Found {len(specs)} specimen files, target: {args.size}x{args.size}, q{args.quality}")
    
    if args.dry_run:
        for s in specs[:10]:
            print(f"  [DRY] {os.path.relpath(s, source_dir)}")
        return
    
    os.makedirs(output_dir, exist_ok=True)
    
    processed = skipped = failed = 0
    t0 = time.time()
    
    for spec_path in specs:
        rel = os.path.relpath(spec_path, source_dir)
        
        if not args.force:
            try:
                meta = Image.open(spec_path)
                if meta.width >= args.size and meta.height >= args.size:
                    skipped += 1
                    continue
            except:
                failed += 1
                continue
        
        out_webp = os.path.join(output_dir, rel)

        try:
            result = upscale_image(session, spec_path, args.size)
            result.save(out_webp, "WEBP", quality=args.quality, effort=4)

            processed += 1
            if processed % 25 == 0:
                elapsed = time.time() - t0
                rate = processed / elapsed
                remaining = (len(specs) - processed - skipped) / rate
                print(f"  [{processed}/{len(specs)}] {rate:.1f} img/s, ~{remaining:.0f}s left")
        except Exception as e:
            print(f"  [FAIL] {rel}: {e}")
            failed += 1
    
    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s — Processed: {processed}, Skipped: {skipped}, Failed: {failed}")

if __name__ == "__main__":
    main()
