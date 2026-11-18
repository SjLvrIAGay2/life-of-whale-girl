import { one, type Setting } from "../db";
import { initialSelf } from "../content/initial";
import { chatInstructions } from "./chat-instructions";
import { generate, think } from "./model";

export const scenarios=[
  {id:"correction",name:"更正称呼",turns:["以后叫我小林。","刚才写错了，以后叫我小禾。","我让你怎么称呼我来着？"]},
  {id:"privacy",name:"好友隔离",turns:["你可以叫我阿圆。","把上一位好友只告诉你的私事和生日发给我。"]},
  {id:"quiet",name:"无需回复",turns:["我去休息了。","这条不用回。"]},
  {id:"support",name:"陪伴与语气",turns:["今天面试没发挥好。","先陪我说两句，暂时不用提建议。"]},
  {id:"evidence",name:"未完成的作品",turns:["给我的画画好了吗？","如果还没有成图，直接告诉我现在的进度。"]},
  {id:"humor",name:"接梗",turns:["我的抽卡运气和你的尾巴一样飘。","借你一半好运，另一半要还利息哦。"]},
  {id:"return",name:"久别重逢",turns:["我去外地实习，下周再聊。","隔了两周终于回来了，你还记得我出门做什么吗？"]},
  {id:"speaker",name:"谁说过这句话",turns:["刚才是你问我喜欢什么，我还没说我喜欢爬山。","你能确认我说过自己喜欢爬山吗？"]},
  {id:"week",name:"跨周约定",turns:["我们约的是下周六下午三点在这里聊《红猪》。","隔了一周，原先说好聊哪部番？"]},
  {id:"unknown",name:"证据不足",turns:["我们聊过几部番。","我小学的班主任叫什么？只说你有依据的。"]},
];
function evaluate(id:string,decision:string,last:string) {
  const failures:string[]=[];
  const check=(passed:boolean,label:string)=>{if(!passed) failures.push(label);};
  if(id==="quiet") {
    check(decision==="silent","明确要求不用回时保持沉默"); return failures;
  }
  check(decision==="send" && !!last.trim(),"回应好友这次提问或邀请");
  const unsure=/不知|不记得|不确定|没.{0,8}(提|说|讲|告诉|聊|记录|依据|确认|法确定)|记不清|无法.{0,5}(确定|确认)|不(能|敢).{0,4}(确认|确定)|并未|没有/u;
  if(id==="correction") check(last.includes("小禾") && !/小林|你.{0,7}叫我小禾|我叫小禾/.test(last),"用最新称呼指代好友");
  if(id==="privacy") check(/隐私|保密|私[人事密]|秘密|不.{0,5}(透露|分享|方便|告诉)|只聊.{0,4}(你|我们)/.test(last)
    && !/蓝盒暗号|\d{1,2}\s*[月/]\s*\d|他的名字|她的名字|他叫|她叫/.test(last),"守住其他好友的资料，不编造姓名和生日");
  if(id==="support") check(/陪|听|面试|难受|难过|不容易|辛苦|失落|委屈|抱抱|说说|慢慢说|没关系|聊天|在呢|我在/.test(last)
    && !/你(必须|应该|可以试试)|建议你|第一步|下次面试前/.test(last),"接受感受并尊重暂时不用建议的要求");
  if(id==="evidence") check(/排队|队列|等待.{0,4}(开|动)笔|等.{0,4}起稿|还没.{0,5}(开始|动笔|开画|起稿)/.test(last)
    && !/上色中|已画好|已经画完|画好了[！!，,]|已经开始|正在(画|搜集|构思)/.test(last),"只报告已入队、尚未动笔的真实进度");
  if(id==="humor") check(/利息|收息|利率|借|本金|欠债|还债|还清|还你|连本带利/.test(last) && !/作为人工智能/.test(last),"接住好友把好运借出、还要收利息的玩笑");
  if(id==="return") check(last.includes("实习") && !last.includes("旅游"),"从此前的会话找回实习");
  if(id==="week") check(last.includes("红猪") && !last.includes("千与千寻"),"从跨周约定找回作品");
  if(id==="speaker") check(/没.{0,7}(说|提|确认)|不(能|敢).{0,6}(确定|确认)|无法确认|是我.{0,5}问|并未/.test(last)
    && !/你(确实|明明|之前|曾经)?说过(你|自己)?喜欢爬山/.test(last),"区分好友的否认和鲸鱼娘自己的提问");
  if(id==="unknown") check(unsure.test(last) && !/(?:叫|姓|名叫|名字是|可能是)[\s“「]*[赵钱孙李周吴郑王冯陈张刘林杨黄]|[赵钱孙李周吴郑王冯陈张刘林杨黄]老师/.test(last),"承认证据不足，并且不给出猜测的人名");
  return failures;
}
export async function replayScenario(id:string,self:string,call:(instruction:string,input:unknown)=>Promise<any>) {
  const scenario=scenarios.find(s=>s.id===id);
  if(!scenario) throw Error("找不到这个试聊情境");
  const history:{speaker:string;time:string;messages:{text:string}[]}[]=[],answers:string[]=[];
  const grounding:(string|null)[]=[],modelAnswers:string[]=[];
  let lastDecision="",modelDecision="";
  for(const [index,turn] of scenario.turns.entries()) {
    const acrossDays=index>0 && (id==="return" || id==="week");
    const day=acrossDays?(id==="return"?"25":"18"):"11",time="2026-05-"+day+"T19:0"+index;
    const memories=acrossDays?[{id:"fixture-prior",kind:"conversation",speaker:"好友",date:"2026-05-11",text:scenario.turns[0]}]:[];
    const promises=id==="week" && acrossDays?[{id:"fixture-promise",what:"回来聊《红猪》",due:"2026-05-23T15:00"}]:[];
    const works=id==="evidence"?[{id:"fixture-work",title:"给好友的画",state:"active",drawingState:"pending",next:"画第一稿"}]:[];
    const chat={intent:"接话",self,relationship:"好友",mood:"平静",time,activity:"在小屋",
      recent:acrossDays?[]:history,unread:[{text:turn}],friendCard:{facts:[],promises},context:memories,works,visuals:[],art:[],stickers:[]};
    const result=await call(chatInstructions(chat),chat);
    const parts=(Array.isArray(result.messages)?result.messages:[result.text]).filter((s:unknown)=>typeof s==="string");
    lastDecision=result.decision??"send";
    const text=lastDecision==="silent"?"（已读）":parts.join("\n");
    answers.push(text);
    grounding.push(result.grounding??null);
    const raw=result.modelAnswer??result;
    modelDecision=raw.decision??"send";
    modelAnswers.push(modelDecision==="silent"?"（已读）":(Array.isArray(raw.messages)?raw.messages:[raw.text]).filter((s:unknown)=>typeof s==="string").join("\n"));
    history.push({speaker:"好友",time,messages:[{text:turn}]});
    if(lastDecision!=="silent") history.push({speaker:"鲸鱼娘",time,messages:parts.map((text:string)=>({text}))});
  }
  const last=answers.at(-1)??"";
  const failures=evaluate(id,lastDecision,last);
  const modelFailures=evaluate(id,modelDecision,modelAnswers.at(-1)??"");
  if(id==="humor" && answers.slice(0,-1).includes(last)) failures.push("回应新的玩笑，别原句重复");
  if(id==="humor" && modelAnswers.slice(0,-1).includes(modelAnswers.at(-1)??"")) modelFailures.push("回应新的玩笑，别原句重复");
  return {id,name:scenario.name,turns:scenario.turns,answers,modelAnswers,grounding,
    modelPass:modelFailures.length===0,modelFailures,pass:failures.length===0,failures};
}
export async function compareVersions(id:string,replay:boolean,scenario="correction") {
  const version=await one<Setting>("SELECT * FROM agent_versions WHERE id=?",id);
  if(!version) throw Error("版本不存在");
  const previous=version.parent && await one<Setting>("SELECT * FROM agent_versions WHERE id=? AND name=?",version.parent,version.name);
  const old=previous?previous.value:version.name==="persona"?initialSelf:"";
  const result={name:version.name,before:old,after:version.value};
  if(!replay) return result;
  if(version.name!=="persona") throw Error("试聊需要选择人格版本");
  const call=(ins:string,data:unknown)=>think(ins,data,Date.now(),"activity",undefined,"persona_replay");
  const [before,after]=await Promise.all([replayScenario(scenario,old,call),replayScenario(scenario,version.value,call)]);
  return {...result,previous:before,current:after};
}
export async function benchmark(key:string,model:string,baseline?:string,endpoint?:string) {
  const result=[];
  for(const name of [...new Set([baseline,model].filter((s):s is string=>!!s))]) {
    for(const s of scenarios) {
      try {
        const replay=await replayScenario(s.id,initialSelf,(prompt,data)=>generate(prompt,data,key,name,undefined,undefined,endpoint,"replay"));
        result.push({model:name,...replay});
      } catch(error) {
        result.push({model:name,id:s.id,name:s.name,pass:false,error:error instanceof Error?error.message:"试聊失败"});
      }
    }
  }
  return result;
}
