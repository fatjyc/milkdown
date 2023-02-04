/* Copyright 2021, Milkdown by Mirone. */
import { serializerMatchError } from '@milkdown/exception'
import type { Fragment, MarkType, Node, NodeType, Schema } from '@milkdown/prose/model'
import { Mark } from '@milkdown/prose/model'

import type { Root } from 'mdast'
import type { JSONRecord, MarkSchema, MarkdownNode, NodeSchema, RemarkParser } from '../utility'
import { Stack } from '../utility'
import { SerializerStackElement } from './stack-element'

const isFragment = (x: Node | Fragment): x is Fragment => Object.prototype.hasOwnProperty.call(x, 'size')

/**
 * State for serializer.
 * Transform prosemirror state into remark AST.
 */
export class SerializerState extends Stack<MarkdownNode, SerializerStackElement> {
  #marks: readonly Mark[] = Mark.none
  readonly schema: Schema
  constructor(schema: Schema) {
    super()
    this.schema = schema
  }

  #matchTarget = (node: Node | Mark): NodeType | MarkType => {
    const result = Object.values({ ...this.schema.nodes, ...this.schema.marks })
      .find((x): x is (NodeType | MarkType) => {
        const spec = x.spec as NodeSchema | MarkSchema
        return spec.toMarkdown.match(node as Node & Mark)
      })

    if (!result)
      throw serializerMatchError(node.type)

    return result
  }

  #runProseNode = (node: Node) => {
    const type = this.#matchTarget(node)
    const spec = type.spec as NodeSchema
    return spec.toMarkdown.runner(this, node)
  }

  #runProseMark = (mark: Mark, node: Node) => {
    const type = this.#matchTarget(mark)
    const spec = type.spec as MarkSchema
    return spec.toMarkdown.runner(this, mark, node)
  }

  #runNode = (node: Node) => {
    const { marks } = node
    const getPriority = (x: Mark) => x.type.spec.priority ?? 50
    const tmp = [...marks].sort((a, b) => getPriority(a) - getPriority(b))
    const unPreventNext = tmp.every(mark => !this.#runProseMark(mark, node))
    if (unPreventNext)
      this.#runProseNode(node)

    marks.forEach(mark => this.#closeMark(mark))
  }

  #searchType = (child: MarkdownNode, type: string): MarkdownNode => {
    if (child.type === type)
      return child

    if (child.children?.length !== 1)
      return child

    const searchNode = (node: MarkdownNode): MarkdownNode | null => {
      if (node.type === type)
        return node

      if (node.children?.length !== 1)
        return null

      const [firstChild] = node.children
      if (!firstChild)
        return null

      return searchNode(firstChild)
    }

    const target = searchNode(child)

    if (!target)
      return child

    const tmp = target.children ? [...target.children] : undefined
    const node = { ...child, children: tmp }
    node.children = tmp
    target.children = [node]

    return target
  }

  #maybeMergeChildren = (node: MarkdownNode): MarkdownNode => {
    const { children } = node
    if (!children)
      return node

    node.children = children.reduce((nextChildren, child, index) => {
      if (index === 0)
        return [child]

      const last = nextChildren.at(-1)
      if (last && last.isMark && child.isMark) {
        child = this.#searchType(child, last.type)
        const { children: currChildren, ...currRest } = child
        const { children: prevChildren, ...prevRest } = last
        if (
          child.type === last.type
          && currChildren
          && prevChildren
          && JSON.stringify(currRest) === JSON.stringify(prevRest)
        ) {
          const next = {
            ...prevRest,
            children: [...prevChildren, ...currChildren],
          }
          return nextChildren
            .slice(0, -1)
            .concat(this.#maybeMergeChildren(next))
        }
      }
      return nextChildren.concat(child)
    }, [] as MarkdownNode[])

    return node
  }

  #createMarkdownNode = (element: SerializerStackElement) => {
    const node: MarkdownNode = {
      ...element.props,
      type: element.type,
    }

    if (element.children)
      node.children = element.children

    if (element.value)
      node.value = element.value

    return node
  }

  /**
     * Transform a prosemirror node tree into remark AST.
     *
     * @param tree - The prosemirror node tree needs to be transformed.
     *
     * @returns The state instance.
     */
  run = (tree: Node) => {
    this.next(tree)

    return this
  }

  /**
     * Use a remark parser to serialize current AST stored.
     *
     * @param remark - The remark parser needs to used.
     * @returns Result markdown string.
     */
  override toString = (remark: RemarkParser): string => remark.stringify(this.build()) as string

  /**
     * Give the node or node list back to the state and the state will find a proper runner (by `match` method) to handle it.
     *
     * @param nodes - The node or node list needs to be handled.
     *
     * @returns The state instance.
     */
  next = (nodes: Node | Fragment) => {
    if (isFragment(nodes)) {
      nodes.forEach((node) => {
        this.#runNode(node)
      })
      return this
    }
    this.#runNode(nodes)
    return this
  }

  openNode = (type: string, value?: string, props?: JSONRecord) => {
    this.open(SerializerStackElement.create(type, undefined, value, props))
    return this
  }

  #addNodeAndPush = (type: string, children?: MarkdownNode[], value?: string, props?: JSONRecord): MarkdownNode => {
    const element = SerializerStackElement.create(type, children, value, props)
    const node: MarkdownNode = this.#maybeMergeChildren(this.#createMarkdownNode(element))
    this.push(node)
    return node
  }

  addNode = (type: string, children?: MarkdownNode[], value?: string, props?: JSONRecord) => {
    this.#addNodeAndPush(type, children, value, props)
    return this
  }

  #closeNodeAndPush = (): MarkdownNode => {
    const element = this.close()
    return this.#addNodeAndPush(element.type, element.children, element.value, element.props)
  }

  closeNode = () => {
    this.#closeNodeAndPush()
    return this
  }

  #openMark = (mark: Mark, type: string, value?: string, props?: JSONRecord) => {
    const isIn = mark.isInSet(this.#marks)

    if (isIn)
      return this

    this.#marks = mark.addToSet(this.#marks)
    return this.openNode(type, value, { ...props, isMark: true })
  }

  #closeMark = (mark: Mark): void => {
    const isIn = mark.isInSet(this.#marks)

    if (!isIn)
      return

    this.#marks = mark.type.removeFromSet(this.#marks)
    this.#closeNodeAndPush()
  }

  withMark = (mark: Mark, type: string, value?: string, props?: JSONRecord) => {
    this.#openMark(mark, type, value, props)
    return this
  }

  closeMark = (mark: Mark) => {
    this.#closeMark(mark)
    return this
  }

  build = (): Root => {
    let doc: Root | null = null
    do
      doc = this.#closeNodeAndPush() as Root
    while (this.size())

    return doc
  }
}
