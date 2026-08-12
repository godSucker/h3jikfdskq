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

  function pick(v: string | null) {
    value = v
    open = false
  }
</script>

<div class="relative">
  <button
    type="button"
    onclick={() => (open = !open)}
    onblur={() => setTimeout(() => (open = false), 150)}
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
      class="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-slate-700/70 bg-slate-900 shadow-xl text-xs"
    >
      {#each options as o (o.value ?? '__none__')}
        <li>
          <button
            type="button"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => pick(o.value)}
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
