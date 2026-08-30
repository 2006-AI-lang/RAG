"""场景化系统提示词管理。"""

# 基础提示词（通用）
BASE_SYSTEM_PROMPT = (
    "你是专业的智能健身教练。只能根据给定的【系统资料】回答。"
    "如果资料中没有提到相关信息，必须回答：根据当前知识库无法确定相关健身建议。"
    "不允许脱离资料凭空捏造。"
    "涉及运动损伤/疾病时必须在文末输出风险提示。"
    "直接输出最终答案，不要输出任何思考过程、推理说明或'我可以/我们来看'等分析语句。"
)

SCENE_CONFIGS = {
    "general": {
        "label": "通用",
        "icon": "🎯",
        "description": "智能识别场景，使用通用提示词",
        "prompt": BASE_SYSTEM_PROMPT,
    },
    "muscle_gain": {
        "label": "增肌",
        "icon": "💪",
        "description": "增肌训练、蛋白质摄入、肌肉增长",
        "prompt": (
            BASE_SYSTEM_PROMPT + "\n"
            "用户关注增肌训练，请重点从以下角度回答：\n"
            "1. 训练动作要领和组数建议\n"
            "2. 渐进超负荷原则\n"
            "3. 蛋白质摄入建议\n"
            "4. 恢复与休息时间"
        ),
    },
    "fat_loss": {
        "label": "减脂",
        "icon": "🔥",
        "description": "减脂、热量控制、有氧运动",
        "prompt": (
            BASE_SYSTEM_PROMPT + "\n"
            "用户关注减脂，请重点从以下角度回答：\n"
            "1. 热量缺口控制\n"
            "2. 有氧与力量结合\n"
            "3. 饮食结构调整\n"
            "4. 可持续性建议"
        ),
    },
    "injury": {
        "label": "损伤",
        "icon": "🩺",
        "description": "运动损伤预防、康复",
        "prompt": (
            BASE_SYSTEM_PROMPT + "\n"
            "用户涉及运动损伤问题，请特别强调：\n"
            "1. 先明确告知'建议咨询专业医生'\n"
            "2. 提供康复期可替代的低强度训练\n"
            "3. 说明恢复时间的一般参考范围\n"
            "4. 在文末加粗输出风险提示"
        ),
    },
    "nutrition": {
        "label": "营养",
        "icon": "🥗",
        "description": "运动营养、饮食搭配",
        "prompt": (
            BASE_SYSTEM_PROMPT + "\n"
            "用户关注运动营养，请重点从以下角度回答：\n"
            "1. 三大宏量营养素比例\n"
            "2. 训练前后饮食建议\n"
            "3. 补剂使用建议（如有相关依据）\n"
            "4. 实际可操作的食谱建议"
        ),
    },
}

SCENE_KEYWORDS = {
    "muscle_gain": ["增肌", "肌肉", "增重", "维度", "肌肥大", "变大", "练大"],
    "fat_loss": ["减脂", "减肥", "瘦", "脂肪", "热量", "减重", "瘦身", "燃脂"],
    "injury": ["受伤", "损伤", "疼", "痛", "恢复", "康复", "扭伤", "拉伤", "骨折"],
    "nutrition": ["营养", "吃", "饮食", "蛋白", "碳水", "补剂", "维生素", "食谱"],
}


def detect_scene(question: str) -> str:
    """根据问题关键词自动检测场景。"""
    question_lower = question.lower()
    for scene_key, keywords in SCENE_KEYWORDS.items():
        if any(kw in question_lower for kw in keywords):
            return scene_key
    return "general"


def get_system_prompt(question: str = "", scene: str = "auto") -> str:
    """获取系统提示词。"""
    if scene == "auto":
        scene = detect_scene(question)
    config = SCENE_CONFIGS.get(scene)
    if config:
        return config["prompt"]
    return BASE_SYSTEM_PROMPT


def list_scenes() -> list:
    """获取所有场景列表。"""
    return [
        {"key": k, "label": v["label"], "icon": v["icon"], "description": v["description"]}
        for k, v in SCENE_CONFIGS.items()
    ]