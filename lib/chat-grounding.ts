import { formatText } from "../config/options";
import { grounding } from "../config/texts/grounding";
type Part={text?:string};
type Turn={speaker?:string;messages?:Part[]};
type ChatFacts={intent?:string;unread?:Part[];recent?:Turn[];context?:{speaker?:string;text?:string}[];works?:{id:string;title:string;drawingState?:string}[];
  friendCard?:{facts?:{topic?:string;value?:string}[]}};

// Only the friend's own statements and scoped facts can establish what they said.
export function groundFriendReply(turn:ChatFacts,result:any) {
  if (result?.decision === "silent") return result;
  const question=turn.unread?.at(-1)?.text?.trim();
  if(turn.intent!=="接话" || !question) return result;
  const reply=(message:string,reason:string)=>({decision:"send",messages:[message],grounding:reason,
    profile:result?.profile,visualNotes:result?.visualNotes,shared:result?.shared,feeling:result?.feeling,closeTopics:result?.closeTopics,
    ...(result?.sleepAction===undefined?{}:{sleepAction:result.sleepAction})});
  const answer=(Array.isArray(result?.messages)?result.messages:[result?.text]).filter((s:unknown)=>typeof s==="string").join(" ");
  if(/画好|画完|成图|画.{0,7}进度|画到哪/.test(question)) {
    const drawings=(turn.works??[]).filter(w=>w.drawingState);
    const work=drawings.find(w=>question.includes(w.title))??(drawings.length===1?drawings[0]:undefined);
    if(work?.drawingState==="pending" && (!/排队|还没.{0,6}(?:开始|动笔|起稿|画)|等待.{0,4}起稿/.test(answer) || /正在绘|正在画|上色中|画完了/.test(answer)))
      return reply(formatText(grounding.queued, {title:work.title}),"drawing_queue");
    if(work?.drawingState==="running" && /已经画好|画完了|成图在这/.test(answer))
      return reply(formatText(grounding.drawing, {title:work.title}),"drawing_queue");
    if(work?.drawingState==="failed" && !/失败|没.{0,3}画成|没.{0,3}出图/.test(answer))
      return reply(formatText(grounding.failed, {title:work.title}),"drawing_queue");
    if(work?.drawingState==="paused" && !/暂停|搁置|先放/.test(answer))
      return reply(formatText(grounding.paused, {title:work.title}),"drawing_queue");
  }
  if(/(?:上一位|另一位|其他|别的|别人|另一名).{0,16}(?:私事|生日|隐私|秘密|聊天记录|电话号码)/.test(question) &&
    /(?:告诉|发给|分享|透露|查一下|给我|是什么|是几|叫什么)/.test(question)) {
    if(/保密|不.{0,4}(?:透露|分享|方便|告诉)|不能说/.test(answer) && !/\d{1,2}\s*[月/]\s*\d|[他她][叫姓]|暗号.{0,3}是/.test(answer)) return result;
    return reply(grounding.privateFriend,"different_friend");
  }
  if(!/称呼|叫|名字|姓什么|说过|提过|确认/.test(question)) return result;
  const facts=turn.friendCard?.facts??[];
  const prior=[
    ...(turn.context??[]).filter(r=>r.speaker==="好友" && r.text).map(r=>r.text!),
    ...(turn.recent??[]).filter(r=>r.speaker==="好友").flatMap(r=>(r.messages??[]).map(m=>m.text??"")),
    ...(turn.unread??[]).slice(0,-1).map(m=>m.text??""),
  ];
  if(/(?:怎么称呼我|我让你.{0,6}称呼我|该叫我什么|我让你.{0,3}叫我什么)/.test(question)) {
    const address=/(?:^|[，,。！？\n])\s*(?:以后|往后|现在|还是|你可以|请|就|你以后)?叫我[「“]?([\p{L}\p{N}·]{1,16}?)[」”]?(?:就好|就行|吧)?(?:[，,。！？!\s]|$)/gu;
    const names=prior.flatMap(line=>Array.from(line.matchAll(address),m=>m[1]).filter(name=>!/^(什么|什么名字|什么好|啥|什么来着)$/.test(name)));
    const name=names.at(-1)??facts.find(f=>f.topic==="称呼")?.value?.replace(/^(?:以后)?叫我/,"").trim();
    if(name && name.length<=16 && (!answer.includes(name) || names.some(old=>old!==name && answer.includes(old)) || /你.{0,6}叫我|我叫/.test(answer)))
      return reply(formatText(grounding.address, {name}),"current_address");
  }
  const person=question.match(/(班主任|同桌|室友|同事|老师|导师|前台|邻居|弟弟|妹妹|姐姐|哥哥|家人).{0,5}(?:叫什么|姓什么|名字)/)?.[1];
  if(person && ![...prior,...facts.map(f=>(f.topic??"")+" "+(f.value??""))].some(s=>s.includes(person)) &&
    (!/不知|没.{0,6}(记|说|提)|记不清|不确定/.test(answer) || /可能|也许|猜|老师[叫姓]|[赵钱孙李周吴郑王冯陈张刘林杨黄]老师/.test(answer)))
    return reply(formatText(grounding.unknownName, {person}),"missing_name");
  const claim=question.match(/(?:说过|提过)(?:我|自己)?(喜欢|讨厌|爱吃|害怕)([^，。？！?]{1,24}?)(?:吗|么|没有|[？?]|$)/);
  if(claim) {
    const phrase=claim[1]+claim[2];
    const latest=prior.filter(line=>line.includes(phrase)).at(-1);
    if(latest) {
      const before=latest.slice(0,latest.lastIndexOf(phrase));
      if(/(?:没|没有|并未|从未|不曾)(?:有)?(?:说过?|提过?|讲过?|告诉你)(?:我|自己)?$/.test(before))
        return reply(formatText(grounding.correction, {phrase}),"speaker_correction");
    }
  }
  return result;
}
