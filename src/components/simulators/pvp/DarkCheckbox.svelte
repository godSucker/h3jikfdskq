<script lang="ts">
  let {
    checked = $bindable(),
    label,
    icon,
  }: {
    checked: boolean
    label: string
    icon?: string
  } = $props()
</script>

<label class="flex items-center gap-1.5 text-xs text-sky-300/80 cursor-pointer select-none">
  <span class="relative inline-flex shrink-0">
    <input type="checkbox" bind:checked class="peer sr-only" />
    <span
      class="w-4 h-4 rounded border border-slate-600 bg-slate-950/80 flex items-center justify-center
             peer-checked:bg-sky-600 peer-checked:border-sky-400 peer-focus-visible:ring-2
             peer-focus-visible:ring-sky-400/60 transition-colors"
    >
      <svg viewBox="0 0 16 16" class="w-2.5 h-2.5 fill-none stroke-white stroke-[2.5] opacity-0 peer-checked:opacity-100">
        <path d="M3 8.5 6.5 12 13 4.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
  </span>
  {#if icon}
    <img src={icon} alt="" class="w-4 h-4" />
  {/if}
  {label}
</label>
