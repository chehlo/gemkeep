// All Tauri invoke() calls go through this file — never call invoke() directly elsewhere
import { invoke } from '@tauri-apps/api/core'

export async function ping(): Promise<string> {
    return invoke('ping')
}
