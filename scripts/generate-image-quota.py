#!/usr/bin/env python3
"""
图片生成配额加密工具

用法：python generate-image-quota.py <数量> <到期日期>

参数：
  数量：0-9999（0 表示无限制）
  到期日期：YYYY-MM-DD 格式（如 2026-06-17），或 0 表示永不过期

输出：35 位加密字符串，附加到 API Key 后面用 - 分隔
  结构：30位数据（10个数字×3字符）+ 2位日期校验 + 3位随机盐 = 35位

示例：
  python generate-image-quota.py 100 2026-06-17    → 100张，2026年6月17日到期
  python generate-image-quota.py 0 0               → 无限制，永不过期
  python generate-image-quota.py 50 2026-12-31     → 50张，2026年12月31日到期

注意：密钥 3 天内有效，每次生成都不同
"""

import sys
import random
from datetime import datetime

# 加密参数（与解密端一致）
CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
CHARSET_LEN = len(CHARSET)
SEEDS = [
    [7, 13, 29],
    [3, 17, 37],
    [9, 23, 41],
    [2, 19, 43],
    [5, 11, 31],
    [8, 27, 47],
    [4, 14, 33],
    [6, 21, 39],
    [1, 16, 44],
    [10, 25, 46],
]


def get_day_seed(date=None):
    """获取天级日期种子（YYYYMMDD 各位数字之和）"""
    if date is None:
        date = datetime.now()
    date_str = date.strftime('%Y%m%d')
    return sum(int(c) for c in date_str)


def generate_salt():
    """生成 3 位随机盐"""
    return ''.join(random.choice(CHARSET) for _ in range(3))


def salt_to_number(salt: str) -> int:
    """将盐转换为数字"""
    total = 0
    for i, c in enumerate(salt):
        total += CHARSET.index(c) * (i + 1)
    return total


def encode(quantity: int, expiry_date: str) -> str:
    """加密数量和到期日期为 35 位字符串"""
    day_seed = get_day_seed()
    salt = generate_salt()
    salt_num = salt_to_number(salt)

    # 解析到期日期为 6 位数字 YYMMDD
    if expiry_date == '0' or expiry_date == '000000':
        date_digits = [0, 0, 0, 0, 0, 0]
    else:
        dt = datetime.strptime(expiry_date, '%Y-%m-%d')
        yy = dt.year % 100
        mm = dt.month
        dd = dt.day
        date_digits = [
            yy // 10, yy % 10,
            mm // 10, mm % 10,
            dd // 10, dd % 10,
        ]

    # 10 位数字：4 位数量 + 6 位日期
    digits = [
        (quantity // 1000) % 10,
        (quantity // 100) % 10,
        (quantity // 10) % 10,
        quantity % 10,
    ] + date_digits

    # 前 30 位：每个数字用 3 字符编码
    result = ''
    for i in range(10):
        d = digits[i]
        for j in range(3):
            shifted = (d * (j + 3) + SEEDS[i][j] + i * 7 + j * 11 + day_seed + salt_num) % CHARSET_LEN
            result += CHARSET[shifted]

    # 中间 2 位：天级日期校验码
    check1 = (day_seed * 7 + 13) % CHARSET_LEN
    check2 = (day_seed * 11 + 29) % CHARSET_LEN
    result += CHARSET[check1]
    result += CHARSET[check2]

    # 末尾 3 位：随机盐
    result += salt

    return result


def decode(encoded: str, day_seed: int) -> dict | None:
    """用指定天级种子解密"""
    if len(encoded) != 35:
        return None

    # 验证日期校验码（第 30-31 位）
    check1 = (day_seed * 7 + 13) % CHARSET_LEN
    check2 = (day_seed * 11 + 29) % CHARSET_LEN
    if CHARSET.index(encoded[30]) != check1 or CHARSET.index(encoded[31]) != check2:
        return None

    # 提取盐（最后 3 位）
    salt = encoded[32:35]
    salt_num = salt_to_number(salt)

    # 解密前 30 位
    digits = []
    for i in range(10):
        candidates = []
        for j in range(3):
            char_index = CHARSET.index(encoded[i * 3 + j])
            if char_index == -1:
                return None
            found_d = None
            for d in range(10):
                if (d * (j + 3) + SEEDS[i][j] + i * 7 + j * 11 + day_seed + salt_num) % CHARSET_LEN == char_index:
                    found_d = d
                    break
            if found_d is None:
                return None
            candidates.append(found_d)

        if candidates[0] != candidates[1] or candidates[1] != candidates[2]:
            return None
        digits.append(candidates[0])

    quantity = digits[0] * 1000 + digits[1] * 100 + digits[2] * 10 + digits[3]
    # 到期日期 YYMMDD
    yy = digits[4] * 10 + digits[5]
    mm = digits[6] * 10 + digits[7]
    dd = digits[8] * 10 + digits[9]

    return {'quantity': quantity, 'expiryYear': yy, 'expiryMonth': mm, 'expiryDay': dd}


def main():
    if len(sys.argv) < 3 or sys.argv[1] in ('-h', '--help'):
        print('用法：python generate-image-quota.py <数量> <到期日期>')
        print('')
        print('参数：')
        print('  数量：0-9999（0 表示无限制）')
        print('  到期日期：YYYY-MM-DD 格式，或 0 表示永不过期')
        print('')
        print('示例：')
        print('  python generate-image-quota.py 100 2026-06-17')
        print('  python generate-image-quota.py 0 0')
        sys.exit(0)

    quantity = int(sys.argv[1])
    expiry_date = sys.argv[2]

    if quantity < 0 or quantity > 9999:
        print('错误：数量必须在 0-9999 之间（0 表示无限制）')
        sys.exit(1)

    if expiry_date != '0':
        try:
            datetime.strptime(expiry_date, '%Y-%m-%d')
        except ValueError:
            print('错误：日期格式必须为 YYYY-MM-DD')
            sys.exit(1)

    encoded = encode(quantity, expiry_date)

    # 自检
    day_seed = get_day_seed()
    decoded = decode(encoded, day_seed)
    if not decoded or decoded['quantity'] != quantity:
        print('错误：加密自检失败！')
        sys.exit(1)

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print('')
    print(f'📊 配额信息：')
    print(f'   数量：{"无限制" if quantity == 0 else f"{quantity} 张"}')
    print(f'   到期日期：{"永不过期" if expiry_date == "0" else expiry_date}')
    print(f'   生成时间：{now}（密钥 3 天内有效）')
    print('')
    print(f'🔑 加密字符串：{encoded}')
    print('')
    print(f'📋 使用方式：将以下内容附加到 API Key 末尾')
    print(f'   your-api-key-{encoded}')
    print('')


if __name__ == '__main__':
    main()
