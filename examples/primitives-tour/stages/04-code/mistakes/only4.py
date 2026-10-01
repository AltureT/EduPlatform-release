# 错误：只判了能否被 4 整除
# 提示：想想 1900 年：它能被 4 整除，也能被 100 整除，它是闰年吗？题目第 2 条要求说了什么？
def is_leap(year):
    return year % 4 == 0


if __name__ == '__main__':
    print(is_leap(2024))
