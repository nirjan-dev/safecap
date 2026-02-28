import { storage } from '#imports'

export interface Recording {
  id: string
  name: string
  createdAt: number
  duration: number
  size: number
  tabTitle?: string
  tabUrl?: string
  blob: string
}

export const recordingsStorage = storage.defineItem<Recording[]>('local:recordings', {
  fallback: [],
  version: 1,
})
