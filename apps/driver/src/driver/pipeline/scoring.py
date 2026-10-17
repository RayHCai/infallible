"""Deterministic task scoring: evaluate a task's ``success`` predicate against
the firmware's final state. No LLM, no ``eval`` — a tiny whitelisted AST walker.

Supported: names (top-level state keys), numbers/strings/bools/None, lists,
comparisons (== != < <= > >= in, not in), and/or/not, unary minus.
Numeric ``==`` uses ``math.isclose`` so ``bolus_units == 2.5`` survives float noise.
"""

import ast
import math
import operator
from functools import lru_cache
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

_CMP: dict[type[ast.cmpop], Callable[[Any, Any], bool]] = {
    ast.Eq: lambda a, b: _eq(a, b),
    ast.NotEq: lambda a, b: not _eq(a, b),
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}


class PredicateError(ValueError):
    pass


def _eq(a: Any, b: Any) -> bool:
    if isinstance(a, int | float) and isinstance(b, int | float) and not isinstance(a, bool):
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-6)
    return bool(a == b)


@lru_cache(maxsize=256)
def _parse(predicate: str) -> ast.expr:
    try:
        return ast.parse(predicate, mode='eval').body
    except SyntaxError as exc:
        raise PredicateError(f'invalid predicate {predicate!r}: {exc.msg}') from exc


def _eval(node: ast.expr, state: Mapping[str, Any]) -> Any:
    match node:
        case ast.Constant(value=v):
            return v
        case ast.Name(id=name):
            if name not in state:
                raise PredicateError(f'unknown state key {name!r}')
            return state[name]
        case ast.List(elts=elts) | ast.Tuple(elts=elts):
            return [_eval(e, state) for e in elts]
        case ast.UnaryOp(op=ast.Not(), operand=x):
            return not _eval(x, state)
        case ast.UnaryOp(op=ast.USub(), operand=x):
            return -_eval(x, state)
        case ast.BoolOp(op=ast.And(), values=vs):
            return all(_eval(v, state) for v in vs)
        case ast.BoolOp(op=ast.Or(), values=vs):
            return any(_eval(v, state) for v in vs)
        case ast.Compare(left=left, ops=ops, comparators=rights):
            lhs = _eval(left, state)
            for op, right in zip(ops, rights, strict=True):
                rhs = _eval(right, state)
                if not _CMP[type(op)](lhs, rhs):
                    return False
                lhs = rhs
            return True
    raise PredicateError(f'unsupported expression: {ast.dump(node)}')


def evaluate(predicate: str, state: Mapping[str, Any]) -> bool:
    return bool(_eval(_parse(predicate), state))
