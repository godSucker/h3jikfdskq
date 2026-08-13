<script lang="ts">
  import { textureUrl } from '@/lib/texture-cdn'

  interface Option {
    value: string | null
    label: string
    icon?: string | null
  }

  let {
    value = $bindable(),
    options,
    placeholder = '—',
  }: {
    value: string | null
    options: Option[]
    placeholder?: string
  } = $props()

  let open = $state(false)
  let selected = $derived(options.find((o) => o.value === value) ?? null)
  let triggerEl: HTMLButtonElement | undefined

  function pick(v: string | null) {
    value = v
    open = false
    triggerEl?.focus()
  }

  // focusout+relatedTarget (не onblur+setTimeout) - старый вариант закрывал список через
  // 150мс ПОСЛЕ blur триггера независимо от того, куда ушёл фокус. При Tab с клавиатуры
  // с триггера на кнопку опции (следующий фокусируемый элемент в DOM) это било по своим:
  // {#if open} размонтировал <ul> с ФОКУСИРОВАННОЙ внутри кнопкой, и фокус улетал в
  // document.body - клавиатурный пользователь терял место на странице. Проверка "новый
  // фокус всё ещё внутри контейнера" закрывает список только когда фокус реально ушёл наружу.
  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null
    const container = e.currentTarget as HTMLElement
    if (!next || !container.contains(next)) open = false
  }

  function onTriggerKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      open = false
    }
  }
</script>

<div class="relative" onfocusout={onFocusOut}>
  <button
    bind:this={triggerEl}
    type="button"
    onclick={() => (open = !open)}
    onkeydown={onTriggerKeydown}
    aria-haspopup="listbox"
    aria-expanded={open}
    class="w-full flex items-center gap-1.5 rounded-lg border border-slate-700/70 bg-slate-950/60 text-sky-100 text-xs px-1.5 py-1"
  >
    {#if selected?.icon}
      <img src={textureUrl(selected.icon)} alt="" class="w-3.5 h-3.5 shrink-0" />
    {/if}
    <span class="truncate flex-1 text-left">{selected?.label ?? placeholder}</span>
    <span class="text-slate-500 shrink-0">▾</span>
  </button>
  {#if open}
    <ul
      role="listbox"
      class="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-slate-700/70 bg-slate-900 shadow-xl text-xs"
    >
      {#each options as o (o.value ?? '__none__')}
        <li role="option" aria-selected={o.value === value}>
          <button
            type="button"
            onclick={() => pick(o.value)}
            onkeydown={(e) => e.key === 'Escape' && (e.preventDefault(), (open = false), triggerEl?.focus())}
            class="w-full flex items-center gap-1.5 text-left px-2 py-1.5 text-sky-100 hover:bg-sky-600/30"
          >
            {#if o.icon}
              <img src={textureUrl(o.icon)} alt="" class="w-3.5 h-3.5 shrink-0" />
            {/if}
            <span class="truncate">{o.label}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
