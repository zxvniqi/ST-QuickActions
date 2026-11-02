// Helpers for watching lists that other code redraws.

const isOwnNode = node => node.nodeType === Node.ELEMENT_NODE && [...node.classList].some(cls => cls.startsWith('stqa_'));

/** Whether a batch of changes only added / removed this extension's own elements (so watchers don't feed each other). */
export function onlyOwnChanges(records) {
    return records.every(record => [...record.addedNodes, ...record.removedNodes].every(isOwnNode)
        && (record.addedNodes.length > 0 || record.removedNodes.length > 0));
}
