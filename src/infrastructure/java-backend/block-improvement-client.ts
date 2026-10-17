import { z } from 'zod';

const change = z.object({componentId:z.string(),metricId:z.string(),name:z.string(),beforeChart:z.string(),afterChart:z.string(),beforeSlot:z.number(),afterSlot:z.number(),reason:z.string()});
const percent=z.string().regex(/^\d+(\.\d+)?%$/);
const preparedBlock=z.object({components:z.array(z.object({metricName:z.string().min(1),chartFamily:z.string().min(1),
  config:z.object({relativeX:percent,relativeY:percent,width:percent,height:percent})})).min(1).max(7)}).passthrough();
export const blockImprovementViewSchema = z.object({invocationId:z.string(),title:z.string(),applicationName:z.string().min(1),chartLabels:z.record(z.string(),z.string()),
  proposal:z.object({diagnosis:z.object({themeFit:z.string(),metricChartFit:z.string(),composition:z.string()}),changes:z.array(change),pendingChecks:z.array(z.string())}),
  actionId:z.string().nullable(),status:z.enum(['proposal','prepared','applying','verified','context_pending','unknown','conflict','failed']),
  preparedBlock:preparedBlock.nullable(),error:z.string().nullable()});
export type BlockImprovementView = z.infer<typeof blockImprovementViewSchema>;
export async function readBlockImprovement(url:string,method:'GET'|'POST'='GET') {
  const response=await fetch(url,{method,cache:'no-store',headers:{accept:'application/json'}});
  const body:unknown=await response.json();
  if(!response.ok){
    const error=z.object({error:z.string()}).safeParse(body);
    throw new Error(error.success?error.data.error:'改造请求未完成,请检查服务状态。');
  }
  const parsed=blockImprovementViewSchema.safeParse(body);
  if(!parsed.success)throw new Error('改造结果格式不正确,未展示确认入口。');
  if(parsed.data.status!=='proposal'&&(!parsed.data.actionId||!parsed.data.preparedBlock))throw new Error('缺少已准备结果,不能确认应用。');
  return parsed.data;
}
