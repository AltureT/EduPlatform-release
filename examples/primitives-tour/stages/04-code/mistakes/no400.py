# 错误：判了 100 忘了 400
# 提示：2000 年能被 100 整除，可它也能被 400 整除。题目第 3 条要求说能被 400 整除的年份怎样？
def is_leap(year):
    return year % 4 == 0 and year % 100 != 0


if __name__ == '__main__':
    print(is_leap(2024))
