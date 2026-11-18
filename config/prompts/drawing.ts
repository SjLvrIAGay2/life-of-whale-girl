export function drawingPrompt(idea:string, style:string, referenceTitle?:string, revisionInstruction?:string) {
  const prompt = [
    "请根据创作意图画一张独立的二次元表情或小画。第一张图是鲸鱼娘的角色设定，画到她时请保留发色、头鳍和尾巴等辨识特征。让动作和神情在聊天缩略图中也清楚可辨。",
    "创作意图：" + idea,
    "绘画偏好：" + style,
  ];
  if (referenceTitle) prompt.push("第二张为社区绘图参考（" + referenceTitle + "），按需借鉴动作、表情或细节，角色身份以第一张为准。");
  if (revisionInstruction)
    prompt.push("最后一张图是初稿。保留其余构图，只做这项修改：" + revisionInstruction);
  return prompt.join("\n");
}
