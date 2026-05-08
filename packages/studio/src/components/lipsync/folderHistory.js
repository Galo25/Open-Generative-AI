/**
 * LipSync folder management — localStorage only.
 * Folders are stored separately; jobs reference a folderId.
 */

const LS_KEY = 'lipsync_folders_v1';

function load() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function save(folders) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(folders));
    } catch { /* storage full */ }
}

export function loadFolders() {
    return load();
}

export function createFolder(name = 'New Folder') {
    const folder = {
        id:        `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name:      name.trim() || 'New Folder',
        createdAt: new Date().toISOString(),
    };
    const folders = [...load(), folder];
    save(folders);
    return { folder, folders };
}

export function renameFolder(id, name) {
    const folders = load().map(f => f.id === id ? { ...f, name: name.trim() || f.name } : f);
    save(folders);
    return folders;
}

export function deleteFolder(id) {
    const folders = load().filter(f => f.id !== id);
    save(folders);
    return folders;
}
