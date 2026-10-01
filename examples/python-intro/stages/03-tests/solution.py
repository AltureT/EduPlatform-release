def grade(score):
    if score >= 90:
        return '优秀'
    if score >= 60:
        return '及格'
    return '不及格'


if __name__ == '__main__':
    print(grade(95))
