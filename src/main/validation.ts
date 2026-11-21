import { categories, fileKinds, quickFileTypes } from '../shared/formats.ts'
import { assetSorts, collections, maxNoteLength, maxTagLength, searchMaxLength } from '../shared/library.ts'
import type { AssetPatch, AssetQuery, LibraryScope } from '../shared/library.ts'

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid library request.')
  }
  return value as Record<string, unknown>
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) {
    throw new Error('Invalid library option.')
  }
  return value as T
}

export function validateId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Invalid library identifier.')
  }
  return value
}

function validateScope(value: unknown): LibraryScope {
  const scope = asObject(value)
  switch (scope.type) {
    case 'collection': return { type: 'collection', collection: oneOf(scope.collection, collections) }
    case 'category': return { type: 'category', category: oneOf(scope.category, categories) }
    case 'folder': return { type: 'folder', folderId: validateId(scope.folderId) }
    default: throw new Error('Invalid library scope.')
  }
}

export function validateQuery(value: unknown): AssetQuery {
  const query = asObject(value)
  if (typeof query.search !== 'string' || query.search.length > searchMaxLength || query.search.includes('\0')) {
    throw new Error('Invalid search text.')
  }
  if (typeof query.offset !== 'number' || !Number.isSafeInteger(query.offset) || query.offset < 0) {
    throw new Error('Invalid results page.')
  }
  if (query.favouritesOnly !== undefined && typeof query.favouritesOnly !== 'boolean') {
    throw new Error('Invalid favourites filter.')
  }
  const scope = validateScope(query.scope)
  if (query.searchWithinFolder !== undefined &&
    (query.searchWithinFolder !== true || scope.type !== 'folder' || !query.search.trim())) {
    throw new Error('Folder search requires a folder and search text.')
  }
  return {
    search: query.search,
    scope,
    searchWithinFolder: query.searchWithinFolder,
    sort: oneOf(query.sort, assetSorts),
    offset: query.offset,
    category: query.category === undefined ? undefined : oneOf(query.category, categories),
    kind: query.kind === undefined ? undefined : oneOf(query.kind, fileKinds),
    fileType: query.fileType === undefined ? undefined : oneOf(query.fileType, quickFileTypes),
    favouritesOnly: query.favouritesOnly,
  }
}

function validateTag(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Tags must contain plain text.')
  }
  const tag = value.trim().normalize('NFC')
  if (!tag || tag.length > maxTagLength) {
    throw new Error(`Tags must be between 1 and ${maxTagLength} characters.`)
  }
  return tag
}

export function validatePatch(value: unknown): AssetPatch {
  const input = asObject(value)
  const patch: AssetPatch = {}
  if (input.category !== undefined) patch.category = oneOf(input.category, categories)
  if (input.favourite !== undefined) {
    if (typeof input.favourite !== 'boolean') throw new Error('Invalid favourite value.')
    patch.favourite = input.favourite
  }
  if (input.addTag !== undefined) patch.addTag = validateTag(input.addTag)
  if (input.removeTag !== undefined) patch.removeTag = validateTag(input.removeTag)
  if (input.notes !== undefined) {
    if (typeof input.notes !== 'string' || input.notes.length > maxNoteLength || input.notes.includes('\0')) {
      throw new Error(`Notes must contain up to ${maxNoteLength.toLocaleString()} characters.`)
    }
    patch.notes = input.notes
  }
  if (!Object.keys(patch).length) throw new Error('No metadata changes were supplied.')
  return patch
}
