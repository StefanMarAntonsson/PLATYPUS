<script lang="ts">
  import { onMount } from 'svelte';
  import { save as showSaveDialog } from '@tauri-apps/plugin-dialog';
  import { createCustomSourceTemplate, type CustomSourceInput } from '$lib/connectors/custom-source.js';
  import type { SourceTemplateV1, TrackingMode } from '$lib/connectors/contracts.js';
  import { importTrackingHistory } from '$lib/tracking.js';
  import {
    addSource,
    importSourcesBundle,
    initSources,
    removeSource,
    saveSourcesBundle,
    setTrackingMode,
    sourcesState,
    testSource,
    updateSource,
  } from '$lib/sources.svelte.js';

  interface Props {
    embedded?: boolean;
  }

  let { embedded = false }: Props = $props();

  const emptyCustomSource = (): CustomSourceInput => ({
    name: '',
    description: '',
    baseUrl: '',
    protocol: 'rest',
    method: 'GET',
    searchPath: '',
    queryParameter: 'q',
    requestBody: '{\n  "query": "${input.query}"\n}',
    graphqlQuery: 'query Search($query: String!) {\n  search(query: $query) {\n    id\n    type\n    title\n  }\n}',
    graphqlVariable: 'query',
    resultsPath: '$',
    providerIdPath: '$.id',
    kindPath: '$.type',
    titlePath: '$.title',
    originalTitlePath: '',
    overviewPath: '',
    artworkPath: '',
    artworkHost: '',
    canonicalUrlPath: '',
  });

  let customSource = $state(emptyCustomSource());
  let message = $state('');
  let testing = $state<string | null>(null);
  let addingCustom = $state(false);
  let importingBundle = $state(false);
  let exportingBundle = $state(false);
  let importingHistory = $state<string | null>(null);
  let expandedConnections = $state<string[]>([]);
  let responsePreview = $state<Record<string, string>>({});
  let bundleInput = $state<HTMLInputElement | null>(null);

  onMount(initSources);

  async function addCustomSource() {
    addingCustom = true;
    try {
      const template = createCustomSourceTemplate(
        customSource,
        sourcesState.sources.map(source => source.template.id),
      );
      const connection = await addSource(template);
      const result = await testSource(connection.id);
      if (result.response !== undefined) {
        responsePreview = { ...responsePreview, [connection.id]: JSON.stringify(result.response, null, 2) };
      }
      message = result.status.state === 'verified'
        ? `${template.name} added and verified.`
        : `${template.name} was added, but its test failed: ${result.status.lastError?.message ?? 'Check the endpoint and mappings.'}`;
      customSource = emptyCustomSource();
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not add the custom source.';
    } finally {
      addingCustom = false;
    }
  }

  async function importBundleFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    importingBundle = true;
    try {
      const result = await importSourcesBundle(await file.text());
      message = `Imported ${result.added} source connection${result.added === 1 ? '' : 's'}${result.skipped ? `; skipped ${result.skipped} already configured.` : '.'}`;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not import the sources file.';
    } finally {
      importingBundle = false;
      input.value = '';
    }
  }

  async function exportSources() {
    exportingBundle = true;
    try {
      const selectedPath = await showSaveDialog({
        title: 'Export PLATYPUS sources',
        defaultPath: 'platypus-sources.json',
        filters: [{ name: 'PLATYPUS sources', extensions: ['json'] }],
      });
      if (!selectedPath) return;
      const path = await saveSourcesBundle(selectedPath);
      message = `Sources exported to ${path}`;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not export sources.';
    } finally {
      exportingBundle = false;
    }
  }

  async function save(id: string, changes: Parameters<typeof updateSource>[1]) {
    try {
      await updateSource(id, changes);
      message = 'Connection saved.';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not save the connection.';
    }
  }

  async function test(id: string) {
    testing = id;
    try {
      const result = await testSource(id);
      if (result.response !== undefined) {
        responsePreview = { ...responsePreview, [id]: JSON.stringify(result.response, null, 2) };
      }
      message = result.status.state === 'verified'
        ? 'Connection verified.'
        : result.status.state === 'degraded'
          ? result.status.lastError?.message ?? 'Connection verified, but search is degraded.'
        : result.status.lastError?.message ?? 'Connection failed.';
    } finally {
      testing = null;
    }
  }

  async function importHistory(template: SourceTemplateV1, connection: (typeof sourcesState.sources)[number]['connection']) {
    importingHistory = connection.id;
    try {
      const result = await importTrackingHistory(template, connection);
      message = `Imported ${result.imported} history event${result.imported === 1 ? '' : 's'}${result.skipped ? `; ${result.skipped} could not be linked.` : '.'}`;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not import tracking history.';
    } finally {
      importingHistory = null;
    }
  }

  function connectionSettingNames(template: SourceTemplateV1): string[] {
    return [...JSON.stringify(template).matchAll(/\$\{connection\.([A-Za-z][\w]*)\}/g)]
      .map(match => match[1])
      .filter((name, index, names) => names.indexOf(name) === index);
  }

  function toggleConnection(connectionId: string) {
    expandedConnections = expandedConnections.includes(connectionId)
      ? expandedConnections.filter(id => id !== connectionId)
      : [...expandedConnections, connectionId];
  }

  const inputClass = 'mt-1 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-500';
</script>

<div class={embedded ? 'space-y-6' : 'max-w-4xl space-y-6 p-4 md:p-6'}>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      {#if embedded}<h2 class="text-sm font-semibold text-zinc-200">Media sources</h2>{:else}<h1 class="text-xl font-bold text-white">Sources</h1>{/if}
      <p class="mt-1 text-xs text-zinc-500">Choose where PLATYPUS searches for metadata and episode information. Library data stays local.</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <button class="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-50" onclick={() => bundleInput?.click()} disabled={importingBundle}>
        {importingBundle ? 'Importing…' : 'Import sources'}
      </button>
      <input class="hidden" bind:this={bundleInput} type="file" accept="application/json,.json" onchange={importBundleFile} />
      <button class="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-50" onclick={exportSources} disabled={!sourcesState.sources.length || exportingBundle}>{exportingBundle ? 'Exporting…' : 'Export all'}</button>
    </div>
  </div>

  <details class="overflow-hidden rounded-md border border-border bg-surface-2/30">
    <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-white">Add a custom API</summary>
    <form class="space-y-4 border-t border-border p-4" onsubmit={event => { event.preventDefault(); void addCustomSource(); }}>
      <p class="text-xs leading-5 text-zinc-500">Configure a public REST or GraphQL JSON search endpoint. Mapping paths describe where fields appear in each result, for example <code>$.id</code> or <code>$.images.poster</code>.</p>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-zinc-500">Source name <span class="text-red-400">*</span><input class={inputClass} required placeholder="TMDB" bind:value={customSource.name} /></label>
        <label class="text-xs text-zinc-500">Base URL <span class="text-red-400">*</span><input class={inputClass} required type="url" placeholder="https://api.example.com/v1" bind:value={customSource.baseUrl} /></label>
      </div>
      <label class="block text-xs text-zinc-500">Description<input class={inputClass} placeholder="What this source provides" bind:value={customSource.description} /></label>

      <div class="grid gap-3 sm:grid-cols-3">
        <label class="text-xs text-zinc-500">API type
          <select class="mt-1 w-full appearance-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-200 outline-none [color-scheme:dark] focus:border-zinc-500" bind:value={customSource.protocol}>
            <option value="rest">REST / JSON</option><option value="graphql">GraphQL</option>
          </select>
        </label>
        {#if customSource.protocol === 'rest'}
          <label class="text-xs text-zinc-500">Method
            <select class="mt-1 w-full appearance-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-200 outline-none [color-scheme:dark] focus:border-zinc-500" bind:value={customSource.method}>
              <option value="GET">GET</option><option value="POST">POST</option>
            </select>
          </label>
        {/if}
        <label class="text-xs text-zinc-500">Search endpoint <span class="text-red-400">*</span><input class={inputClass} required placeholder="/search" bind:value={customSource.searchPath} /></label>
      </div>

      {#if customSource.protocol === 'graphql'}
        <div class="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <label class="text-xs text-zinc-500">GraphQL query <span class="text-red-400">*</span><textarea class="mt-1 h-36 w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-zinc-500" required bind:value={customSource.graphqlQuery}></textarea></label>
          <label class="text-xs text-zinc-500">Search variable<input class={inputClass} placeholder="query" bind:value={customSource.graphqlVariable} /></label>
        </div>
      {:else if customSource.method === 'POST'}
        <label class="block text-xs text-zinc-500">JSON request body <span class="text-red-400">*</span><textarea class="mt-1 h-28 w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-zinc-500" required bind:value={customSource.requestBody}></textarea></label>
      {:else}
        <label class="block max-w-xs text-xs text-zinc-500">Search query parameter<input class={inputClass} placeholder="q" bind:value={customSource.queryParameter} /></label>
      {/if}

      <fieldset class="space-y-3 rounded-md border border-border/70 p-3">
        <legend class="px-1 text-xs font-medium text-zinc-400">JSON response mappings</legend>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="text-xs text-zinc-500">Results array <span class="text-red-400">*</span><input class={inputClass} required placeholder="$.results" bind:value={customSource.resultsPath} /></label>
          <label class="text-xs text-zinc-500">Provider ID <span class="text-red-400">*</span><input class={inputClass} required placeholder="$.id" bind:value={customSource.providerIdPath} /></label>
          <label class="text-xs text-zinc-500">Media type <span class="text-red-400">*</span><input class={inputClass} required placeholder="$.type" bind:value={customSource.kindPath} /></label>
          <label class="text-xs text-zinc-500">Title <span class="text-red-400">*</span><input class={inputClass} required placeholder="$.title" bind:value={customSource.titlePath} /></label>
          <label class="text-xs text-zinc-500">Original title<input class={inputClass} placeholder="$.original_title" bind:value={customSource.originalTitlePath} /></label>
          <label class="text-xs text-zinc-500">Description<input class={inputClass} placeholder="$.overview" bind:value={customSource.overviewPath} /></label>
          <label class="text-xs text-zinc-500">Poster URL<input class={inputClass} placeholder="$.poster_url" bind:value={customSource.artworkPath} /></label>
          <label class="text-xs text-zinc-500">Media page URL<input class={inputClass} placeholder="$.url" bind:value={customSource.canonicalUrlPath} /></label>
        </div>
        <label class="block max-w-sm text-xs text-zinc-500">Artwork hostname<input class={inputClass} placeholder="images.example.com" bind:value={customSource.artworkHost} /></label>
      </fieldset>

      <button class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50" type="submit" disabled={addingCustom}>{addingCustom ? 'Adding and testing…' : 'Add & test connection'}</button>
    </form>
  </details>

  {#if message}<p class="rounded-md border border-border bg-surface-2/30 px-3 py-2 text-sm text-zinc-400">{message}</p>{/if}

  <section class="space-y-3">
    <h3 class="text-sm font-semibold text-zinc-200">Configured connections</h3>
    {#if !sourcesState.ready}
      <p class="text-sm text-zinc-500">Loading sources…</p>
    {:else if !sourcesState.sources.length}
      <p class="rounded-md border border-dashed border-border py-10 text-center text-sm text-zinc-500">No sources configured yet.</p>
    {:else}
      {#each sourcesState.sources as source (source.connection.id)}
        {@const expanded = expandedConnections.includes(source.connection.id)}
        {@const searchState = source.connection.capabilities.search?.state}
        <article class="overflow-hidden rounded-md border border-border bg-surface-2/30 transition-colors hover:border-zinc-600">
          <div class="flex min-h-14 items-stretch">
            <button
              class="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
              aria-expanded={expanded}
              aria-controls={`connection-${source.connection.id}`}
              onclick={() => toggleConnection(source.connection.id)}
            >
              <svg class="h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform {expanded ? 'rotate-90' : ''}" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="m7.25 4.5 5.5 5.5-5.5 5.5V4.5Z" /></svg>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-zinc-100">{source.connection.name}</span>
                <span class="block truncate text-xs text-zinc-500">{source.template.name} · {new URL(source.connection.baseUrl).hostname}</span>
              </span>
              {#if searchState}
                <span class="rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize
                  {searchState === 'verified'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : searchState === 'degraded'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      : 'border-red-500/30 bg-red-500/10 text-red-400'}">{searchState}</span>
              {:else}
                <span class="rounded-full border border-border bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-500">Not tested</span>
              {/if}
            </button>
            <label class="flex shrink-0 items-center gap-2 border-l border-border px-4 text-xs text-zinc-400">
              <input type="checkbox" checked={source.connection.enabled} onchange={event => save(source.connection.id, { enabled: event.currentTarget.checked })} /> Enabled
            </label>
          </div>

          {#if expanded}
            <div id={`connection-${source.connection.id}`} class="space-y-3 border-t border-border p-4">
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="text-xs text-zinc-500">Connection name<input class={inputClass} value={source.connection.name} onchange={event => save(source.connection.id, { name: event.currentTarget.value })} /></label>
            <label class="text-xs text-zinc-500">Base URL<input class={inputClass} value={source.connection.baseUrl} onchange={event => save(source.connection.id, { baseUrl: event.currentTarget.value })} /></label>
          </div>

          {#if connectionSettingNames(source.template).length}
            <div class="grid gap-2 sm:grid-cols-2">
              {#each connectionSettingNames(source.template) as setting}
                <label class="text-xs text-zinc-500">{setting}<input class={inputClass} value={String(source.connection.settings[setting] ?? '')} onchange={event => save(source.connection.id, { settings: { ...source.connection.settings, [setting]: event.currentTarget.value } })} /></label>
              {/each}
            </div>
          {/if}

          {#if source.template.operations.history}
            <label class="text-xs text-zinc-500">Tracking mode
              <span class="relative mt-1 block">
                <select class="w-full appearance-none rounded-md border border-border bg-surface-2 py-2 pl-3 pr-9 text-sm text-zinc-200 outline-none [color-scheme:dark] focus:border-zinc-500" value={source.connection.tracking.mode} onchange={event => setTrackingMode(source.connection.id, event.currentTarget.value as TrackingMode)}>
                  <option value="import_only">Import only</option><option value="export_only">Export only</option><option value="bidirectional">Bidirectional</option>
                </select>
                <svg class="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" /></svg>
              </span>
            </label>
          {/if}

          <div class="rounded-md bg-surface-2 px-3 py-2 text-xs leading-5 text-zinc-500">
            <p>Allowed API hosts: {source.template.allowedHosts.join(', ')}</p>
            <p>Operations: {Object.keys(source.template.operations).join(', ')}</p>
            <p>Authentication: {source.template.authentication.type}</p>
          </div>

          {#if source.template.authentication.type !== 'none'}
            <p class="text-xs text-amber-400">Credential storage is not available yet, so authenticated requests remain disabled.</p>
          {/if}

          <div class="flex flex-wrap gap-2">
            <button class="rounded-md border border-border px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-50" onclick={() => test(source.connection.id)} disabled={testing === source.connection.id}>{testing === source.connection.id ? 'Testing…' : 'Test connection'}</button>
            {#if source.template.operations.history && source.connection.tracking.mode !== 'export_only'}
              <button class="rounded-md border border-border px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500" onclick={() => importHistory(source.template, source.connection)} disabled={importingHistory === source.connection.id}>{importingHistory === source.connection.id ? 'Importing…' : 'Import history'}</button>
            {/if}
            <button class="rounded-md border border-red-900/60 px-3 py-1.5 text-sm text-red-400 hover:border-red-700" onclick={() => removeSource(source.connection.id)}>Remove connection</button>
          </div>

          {#if source.connection.capabilities.search}
            <p class="text-xs {source.connection.capabilities.search.state === 'verified' ? 'text-emerald-400' : source.connection.capabilities.search.state === 'degraded' ? 'text-amber-400' : 'text-red-400'}">Search: {source.connection.capabilities.search.state}</p>
          {/if}
          {#if source.connection.tracking.audit.length}
            <p class="text-xs text-zinc-500">Latest tracking sync: {source.connection.tracking.audit.at(-1)?.outcome} · {source.connection.tracking.audit.at(-1)?.processed} events</p>
          {/if}
          {#if responsePreview[source.connection.id]}
            <details class="rounded-md border border-border bg-surface-2 px-3 py-2"><summary class="cursor-pointer text-xs text-zinc-300">Latest JSON response preview</summary><pre class="mt-2 max-h-72 overflow-auto text-[11px] text-zinc-400">{responsePreview[source.connection.id]}</pre></details>
          {/if}
            </div>
          {/if}
        </article>
      {/each}
    {/if}
  </section>
</div>
