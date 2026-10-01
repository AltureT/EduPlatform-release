# 由 npm run prep:tests 生成，不要手改；期望值只存哈希
import hashlib


def _h(v):
    return hashlib.sha256(repr(v).encode()).hexdigest()[:16]


def _call(expr):
    import main
    return eval(expr, vars(main))


def test_hidden_1():
    """隐藏用例：整百年不是闰年"""
    assert _h(_call("is_leap(1900)")) == '60a33e6cf5151f2d'


def test_hidden_2():
    """隐藏用例：四百年是闰年"""
    assert _h(_call("is_leap(2000)")) == '3cbc87c7681f34db'


def test_hidden_3():
    """隐藏用例：普通闰年"""
    assert _h(_call("is_leap(2024)")) == '3cbc87c7681f34db'
