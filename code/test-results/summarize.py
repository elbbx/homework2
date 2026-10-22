import math

def summarize(scores):
    """
    计算成绩列表的统计摘要。
    :param scores: 非空数值列表，元素 ∈ [0, 100]
    :return: (平均值, 最大值, 最小值)
    :raises ValueError: 空列表、非数值元素或越界值
    """
    if not scores:
        raise ValueError("空列表")

    for i, x in enumerate(scores):
        # bool 是 int 的子类，但语义上不是合法成绩，需排除
        if isinstance(x, bool):
            raise ValueError(f"第{i+1}项为布尔值，非合法成绩")
        if not isinstance(x, (int, float)):
            raise ValueError(f"第{i+1}项类型为 {type(x).__name__}，非数值")
        if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
            raise ValueError(f"第{i+1}项为非法浮点数（NaN 或 Inf）")
        if x < 0 or x > 100:
            raise ValueError("成绩超出0-100范围")

    avg = sum(scores) / len(scores)
    max_val = max(scores)
    min_val = min(scores)
    return (avg, max_val, min_val)
