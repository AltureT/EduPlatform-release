# 由 npm run prep:tests 生成，不要手改；期望值只存哈希
import hashlib


def _h(v):
    return hashlib.sha256(repr(v).encode()).hexdigest()[:16]


def _call(expr):
    import main
    return eval(expr, vars(main))


def test_hidden_1():
    """隐藏用例：满分"""
    assert _h(_call("grade(100)")) == 'f289732bfe855c2c'


def test_hidden_2():
    """隐藏用例：零分"""
    assert _h(_call("grade(0)")) == 'bf2de843e5d68fb5'
