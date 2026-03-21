# Character Review Modal — Design Spec
Date: 2026-03-21

## Overview

After creating a new story (paste text or Write for Me), Story Studio automatically scans the story text with LM Studio, extracts named characters, and generates a watercolor portrait for each. A mandatory Step 3 in the New Story wizard lets the user review, edit, and confirm before any characters are saved to the global library.

## User Flow

1. User completes Step 1 (name / language / style) and Step 2 (paste text or AI write).
2. User clicks "Create Story" — project is created immediately.
3. NewStoryModal advances to **Step 3: Character Review**, showing a "Discovering characters…" spinner while `characters:auto-discover` runs.
4. Step 3 always appears (both flows, even if 0 characters found).
5. **If 0 characters found:** informational message + "Close & Start Editing →" button.
6. **If characters found:** grid of editable character cards (see UI below).
7. User reviews/edits/regenerates, then clicks "Save N Characters →" or "Skip".
8. On Save: `characters:save-batch` persists all remaining cards to the global library. Modal closes.
9. On Skip / Cancel: no characters saved. Modal closes.

## Step 3 UI

### Modal header in Step 3
The step indicator shows "Step 3 of 3" (update the hardcoded "of 2" to "of 3" throughout NewStoryModal). The Cancel button remains visible in Step 3 and behaves identically to Skip: closes the modal without saving any characters.

### Zero-characters state
```
🎭 No characters found

No named characters were detected in this story.
You can always add characters manually in Settings → Character References.

                              [ Close & Start Editing → ]
```
If auto-discover fails (LM Studio offline), show instead:
```
⚠️ Character detection unavailable

LM Studio is offline. You can add characters manually in Settings → Character References.

                              [ Close & Start Editing → ]
```

### Characters-found state

**Header:** "🎭 Meet the Characters" with subtitle "Review the portraits before saving to your character library."

**Grid:** 2-column grid of character cards. Each card:
- Square portrait image (full-width top section, aspect-square, object-cover), served via `localfile:///` protocol
- Editable name input (small, single line) — pre-filled from LM Studio extraction
- Editable description textarea (2 rows) — pre-filled from LM Studio; used as prompt hint for regeneration
- "↻ Regenerate" button (below textarea) — tracked by **card index** (not name, since name is editable); spins and disables during generation; on success updates card's `imagePath` with the new path returned by the IPC call, then appends `?bust=<timestamp>` to the `src` to force a browser image reload
- × remove button (absolute top-right corner) — removes card from list; count in footer updates

**Footer:**
- Left: "Skip" button (secondary style) — closes without saving (same as Cancel)
- Right: "Save N Characters →" button (primary, purple) — N = current card count; **disabled** when `isDiscovering` is true OR when 0 cards remain

## Architecture

### Shared helper: `sanitizeFilename(name)`

Both `characters:auto-discover` and `character:regenerate-portrait` must produce identical file paths for the same character name. Define a single inline helper at the top of the relevant section of main.js:

```js
function sanitizeCharacterName(name) {
  return name.replace(/[^a-zA-Z0-9\-_]/g, '_')
}
```

Use `sanitizeCharacterName(char.name)` wherever a character name is used as part of a file path in both handlers.

### Backend — electron/main.js

**Modify `characters:auto-discover`:**

1. Fix the known-names deduplication filter: both the `newChars` filter and the `skipped` filter must use lowercase comparison. Change to:
   ```js
   const newChars = extracted.filter(c => c.name && !knownNamesLower.has(c.name.toLowerCase()))
   const skipped  = extracted.filter(c => c.name &&  knownNamesLower.has(c.name.toLowerCase())).map(c => c.name)
   ```
2. Use `sanitizeCharacterName(char.name)` when building `destPath`:
   ```js
   const destPath = path.join(charactersDir, `${sanitizeCharacterName(char.name)}_reference.png`)
   ```
3. **Remove the entire inner store-persistence block** (the fresh-read guard + `store.set` call inside the per-character loop). Delete these lines entirely:
   ```js
   // Add to library (re-read fresh to avoid races with concurrent calls)
   const freshChars = store.get('characters', [])
   if (!freshChars.some(c => c.name === char.name)) {
     store.set('characters', [...freshChars, { ... }])
   }
   ```
   Characters are persisted only via `characters:save-batch` after user confirmation.
4. Return `{ success: true, data: { added: [{name, imagePath, description}], skipped } }` — unchanged interface.

**Add `characters:save-batch`:**
- Input: `{ characters: [{name, imagePath, description}] }`
- For each entry: add to electron-store `characters` array if not already present (case-insensitive name check against existing entries).
- Return `{ success: true, data: updatedArray }`.

**Add `character:regenerate-portrait`:**
- Input: `{ name, description }`
- Use `sanitizeCharacterName(name)` for the output filename — same function as above.
- Build portrait prompt (same format as auto-discover: watercolor, full body, plain background, safe for kids).
- Generate to `voices/characters/{sanitized_name}_reference.png` (overwrites existing file).
- Return `{ success: true, data: { name, imagePath } }`.

Note: old portrait files from previous regeneration runs are overwritten in place. No cleanup of orphaned files is required in this spec.

### Frontend — electron/preload.js

Expose three new channels (one already existed as `characterAutoDiscover` — verify it is already present):
```js
charactersSaveBatch:         (args) => ipcRenderer.invoke('characters:save-batch', args),
characterRegeneratePortrait: (args) => ipcRenderer.invoke('character:regenerate-portrait', args),
```
(`characterAutoDiscover` mapping to `characters:auto-discover` already exists.)

### Frontend — src/hooks/useIPC.js

**`useAutoDiscoverCharacters`** already exists — it is called from SceneList.jsx. NewStoryModal will use this same hook (do not add a duplicate).

Add two new hooks:

**`useSaveDiscoveredCharacters`:**
```js
export function useSaveDiscoveredCharacters() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ characters }) => {
      const res = await api.charactersSaveBatch({ characters })
      if (!res.success) throw new Error(res.error)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] })
    },
  })
}
```

**`useRegeneratePortrait`:**
```js
export function useRegeneratePortrait() {
  return useMutation({
    mutationFn: async ({ name, description }) => {
      const res = await api.characterRegeneratePortrait({ name, description })
      if (!res.success) throw new Error(res.error)
      return res.data  // { name, imagePath }
    },
  })
}
```

**Modify `useCreateProject.onSuccess`:** Remove only the fire-and-forget `api.characterAutoDiscover(...)` block (lines that call it and chain `.then`/`.catch`). Keep `qc.invalidateQueries({ queryKey: ['projects'] })` and `setCurrentProject(project)` intact. The `characters` query invalidation that was inside the `.then()` is now intentionally dropped here — it will fire from `useSaveDiscoveredCharacters.onSuccess` when the user confirms in Step 3.

### Frontend — src/components/NewStoryModal.jsx

**New state:**
- `step` already exists (1 or 2) — extend to support 3. Update all "of 2" text to "of 3".
- `discoveredChars: [{name, imagePath, description}]` — local editable array, one entry per card. Initialized to `[]`.
- `isDiscovering: boolean` — shows spinner while auto-discover runs. Initialized to `false`.
- `autoDiscoverError: boolean` — set to `true` if auto-discover throws. Initialized to `false`.
- `regeneratingIndices: Set<number>` — which card indices are currently regenerating. Use `useState(new Set())`.

**Import hooks at top of component:**
```js
import { useAutoDiscoverCharacters, useSaveDiscoveredCharacters, useRegeneratePortrait } from '../hooks/useIPC'
```

**After `createProject.mutateAsync` succeeds:**
```js
setStep(3)
setIsDiscovering(true)
try {
  const result = await autoDiscover.mutateAsync({ projectId: project.id })
  setDiscoveredChars(result.added ?? [])
} catch (err) {
  setAutoDiscoverError(true)
} finally {
  setIsDiscovering(false)
}
```
Note: `autoDiscover.mutateAsync` calls `characters:auto-discover` which no longer saves to the store, so this is safe to call here without side effects.

**On "Save N Characters →":**
```js
await saveDiscovered.mutateAsync({ characters: discoveredChars })
closeNewStoryModal()
```

**On "Skip" / Cancel / "Close & Start Editing →":**
```js
closeNewStoryModal()
```

**Regenerate flow (card at index `i`):**
```js
setRegeneratingIndices(prev => new Set([...prev, i]))
try {
  const result = await regeneratePortrait.mutateAsync({
    name: discoveredChars[i].name,
    description: discoveredChars[i].description,
  })
  setDiscoveredChars(prev => prev.map((c, idx) =>
    idx === i ? { ...c, imagePath: result.imagePath + `?bust=${Date.now()}` } : c
  ))
} catch (err) {
  // show inline error on card i — use a per-card error state or a simple toast
} finally {
  setRegeneratingIndices(prev => { const s = new Set(prev); s.delete(i); return s })
}
```

## Data Model

Characters in electron-store (`characters` key) — unchanged shape:
```js
[{ name: string, imagePath: string, description: string }]
```
`characters:save-batch` writes the same shape as `character:add`.

## Error Handling

- **LM Studio offline during auto-discover:** set `autoDiscoverError = true`, show offline message in step 3. Story creation is not affected.
- **Individual regeneration failure:** show inline error on that card ("Regeneration failed — try again"), keep old portrait, clear spinner. Do not close modal.
- **`characters:save-batch` failure:** show error in footer area, keep modal open so user can retry.

## Out of Scope

- No deduplication UI — the `skipped` list is not shown to the user.
- No portrait generation fallback if LM Studio is offline.
- No changes to the "Generate All" flow — auto-discover there saves silently (no review step). Since `characters:auto-discover` no longer saves to the store itself, `handleGenerateAllImages` in SceneList.jsx must call `characters:save-batch` immediately after a successful auto-discover result. Add `useSaveDiscoveredCharacters` to SceneList.jsx imports and insert this after `setDiscoverResult(result)`:
  ```js
  if (result.added.length > 0) {
    await saveDiscovered.mutateAsync({ characters: result.added })
  }
  ```
  This replaces the store-persistence behavior that was removed from `characters:auto-discover`.
- Editing a character name in Step 3 does not update any existing library entry.
