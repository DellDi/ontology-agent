import { z } from 'zod';
import { javaObjectSelectionSchema } from './object-read-contract';

const change = z.object({componentId:z.string(),metricId:z.string(),name:z.string(),beforeChart:z.string(),afterChart:z.string(),beforeSlot:z.number(),afterSlot:z.number(),reason:z.string()});
const percent=z.string().regex(/^\d+(\.\d+)?%$/);
const preparedBlock=z.object({components:z.array(z.object({metricName:z.string().min(1),chartFamily:z.string().min(1),
  config:z.object({relativeX:percent,relativeY:percent,width:percent,height:percent})})).min(1).max(7)}).passthrough();
export const blockImprovementViewSchema = z.object({invocationId:z.string(),executionAvailable:z.boolean(),selection:javaObjectSelectionSchema.refine(selection=>selection.reference.objectKey==='easyv-prototype-block'&&!selection.additionalReferences?.length,'改进目标必须是单个正式区域引用。'),title:z.string(),applicationName:z.string().min(1),chartLabels:z.record(z.string(),z.string()),
  proposal:z.object({textChange:z.object({beforeTitle:z.string(),afterTitle:z.string(),beforePurpose:z.string(),afterPurpose:z.string()}).nullable().optional(),diagnosis:z.object({themeFit:z.string(),metricChartFit:z.string(),composition:z.string()}),changes:z.array(change),pendingChecks:z.array(z.string())}),
  actionId:z.string().nullable(),status:z.enum(['proposal','prepared','applying','verified','context_pending','unknown','conflict','failed']),
  preparedBlock:preparedBlock.nullable(),error:z.string().nullable()});
export type BlockImprovementView = z.infer<typeof blockImprovementViewSchema>;
export const blockImprovementStatusLabels: Record<BlockImprovementView['status'], string> = {
  proposal: '未应用', prepared: '待确认', applying: '保存中', verified: '已保存并核对',
  context_pending: '编辑上下文待恢复', unknown: '结果待核查', conflict: '原型已变化', failed: '执行失败',
};
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

/** 页面建议列表与详情共享同一份后端状态；请求失败不重试，展开不会另建动作。 */
export function blockImprovementQuery(sessionId:string,executionId:string,invocationId:string) {
  return {queryKey:['block-improvement',sessionId,executionId,invocationId],
    queryFn:()=>readBlockImprovement(`/api/analysis/sessions/${encodeURIComponent(sessionId)}/block-improvements/${encodeURIComponent(executionId)}/${encodeURIComponent(invocationId)}`),
    retry:false as const,refetchOnMount:false as const,gcTime:0};
}
