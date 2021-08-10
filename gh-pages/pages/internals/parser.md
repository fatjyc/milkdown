# Parser

Parser is used to transform from markdown string to UI elements.

## Transform Steps

The transformation will have following steps:

1. The markdown string will be given to [remark-parse](https://github.com/remarkjs/remark/tree/main/packages/remark-parse) to compile into AST.
2. The remark AST will be traversed by milkdown parser. The milkdown parser is generated by the parser property of nodes and marks and generate a prosemirror node tree as the result.
3. The prosemirror node will rendered by prosemirror and generate the UI elements.

## Example

For every node, there will be a parser specification which has the following structure:

```typescript
import { nodeFactory } from '@milkdown/core';

const myNode = nodeFactory({
    // other props...
    parser: {
        match: (node) => node.type === 'my-node',
        runner: (state, node, type) => {
            state.openNode(type).next(node.children).closeNode();
        },
    },
});
```

## Parser Specification

The parser specification has 2 props:

-   _match_: match the target remark node that need to be handled by this runner.

-   _runner_: the function that transform the remark into prosemirror node, it has 3 parameters:

    -   _state_: tools used to generate the prosemirror node.
    -   _node_: the remark node that need to be handled.
    -   _type_: the prosemirror _[nodeType](https://prosemirror.net/docs/ref/#model.NodeType)_ of current node,
        defined by `schema` property of current node.

## Parser State

The parser state is used to generate the prosemirror node,
it provides several useful methods to make the transformation pretty simple.

First of all, we should keep in mind that the tree we need to handle has following structure:

```typescript
interface NodeTree {
    type: string;
    children: NodeTree[];
    [x: string]: unknown;
}
```

Then, it's easy to understand our state API.

### openNode & closeNode

`openNode` method will open a node, and all nodes created after this method will be set as the children of the node until a `closeNode` been called.

You can imagine `openNode` as the left half of parenthesis and `closeNode` as the right half. For nodes have children, your runner should just take care of the node itself and let other runners to handle the children.

You can pass the node's attributes as the second parameter for `openNode`.

### addNode

`addNode` means just add a node without open or close it. It's useful for nodes which don't have children.

You can pass the node's attributes as the second parameter.

### next

`next` give the node or node list back to the state and the state will find a proper runner (by `match` method) to handle it.

### openMark & closeMark

These two APIs are pretty like `openNode` and `closeNode`, but just for marks.

You can pass the marks's attributes as the second parameter for `openMark`.