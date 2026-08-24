// Группировка квестов /guides в цепочки по prevId. Данные подтверждены разведкой
// (2026-08-24): среди 297 квестов ни одного слияния (multi-parent) - только
// ветвление (один квест открывает несколько следующих). Значит каждая цепочка -
// ДЕРЕВО, не общий граф - можно строить простым обходом без графовых библиотек.
// Никаких придуманных названий цепочек не генерируем - группируем визуально.

export interface QuestLike {
  id: string
  prevId: string | null
  chainType: 'story' | 'achievement'
}

export interface QuestNode<T extends QuestLike> {
  quest: T
  children: QuestNode<T>[]
}

export interface QuestChain<T extends QuestLike> {
  chainType: 'story' | 'achievement'
  roots: QuestNode<T>[]
  size: number
}

export function buildQuestChains<T extends QuestLike>(quests: T[]): QuestChain<T>[] {
  const byId = new Map(quests.map((q) => [q.id, q]))
  const childrenOf = new Map<string, T[]>()
  const roots: T[] = []

  for (const q of quests) {
    if (q.prevId && byId.has(q.prevId)) {
      const list = childrenOf.get(q.prevId) ?? []
      list.push(q)
      childrenOf.set(q.prevId, list)
    } else {
      roots.push(q)
    }
  }

  function buildNode(q: T): QuestNode<T> {
    const kids = (childrenOf.get(q.id) ?? []).map(buildNode)
    return { quest: q, children: kids }
  }

  // Компонента связности = все квесты, достижимые от корня + сам корень.
  // Корни без потомков и без предка - одиночные квесты (14 из 297) - тоже
  // цепочка, просто размера 1, единый вид для UI.
  const chainByRootId = new Map<string, QuestNode<T>>()
  for (const root of roots) chainByRootId.set(root.id, buildNode(root))

  function countSize(node: QuestNode<T>): number {
    return 1 + node.children.reduce((sum, c) => sum + countSize(c), 0)
  }

  const chains: QuestChain<T>[] = [...chainByRootId.values()].map((rootNode) => ({
    chainType: rootNode.quest.chainType,
    roots: [rootNode],
    size: countSize(rootNode),
  }))

  // Крупные сначала - удобнее сканировать список.
  chains.sort((a, b) => b.size - a.size)
  return chains
}
