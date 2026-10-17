package com.dip3.ontologyagent.easyv.internal.adapter.out.http;

import com.dip3.ontologyagent.easyv.internal.application.EasyVBlockActionPort;
import com.dip3.ontologyagent.support.BackendException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Component
@ConditionalOnProperty(prefix="dip3.easyv",name="enabled",havingValue="true")
public final class EasyVBlockActionHttpAdapter implements EasyVBlockActionPort {
  private static final Logger log=LoggerFactory.getLogger(EasyVBlockActionHttpAdapter.class);
  private final ObjectMapper json = new ObjectMapper();
  private final String baseUrl, token;
  private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
      .followRedirects(HttpClient.Redirect.NEVER).build();
  public EasyVBlockActionHttpAdapter(@Value("${EASYV_ACTION_BASE_URL:}") String baseUrl,
      @Value("${EASYV_ACTION_TOKEN:}") String token) {this.baseUrl=baseUrl;this.token=token;}
  public Map<String,Object> prepare(Map<String,Object> plan,String user,String space,String team) {
    return call("prepare",plan,user,space,team);
  }
  public Map<String,Object> apply(Map<String,Object> prepared,String user,String space,String team) {
    return call("apply",prepared,user,space,team);
  }
  @SuppressWarnings("unchecked")
  private Map<String,Object> call(String operation,Map<String,Object> body,String user,String space,String team) {
    if(baseUrl.isBlank()||token.isBlank()) throw new BackendException("EASYV_ACTION_NOT_CONFIGURED",
        "尚未接通当前业务源的 EasyV 编辑接口。已有提案已保留,配置正式接口后即可准备改造。");
    try {
      URI uri=URI.create(baseUrl.replaceAll("/+$","")+"/ai-agent/tools/screen/blocks/improvement/"+operation);
      if(!java.util.Set.of("http","https").contains(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)
        throw new IllegalArgumentException("Invalid EasyV action endpoint");
      var request=HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(operation.equals("prepare")?60:25)).header("Content-Type","application/json")
          .header("Easyv-Secret-Token",token).header("op-user-id",user).header("space-id",space).header("team-id",team)
          .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
      var response=client.send(request,HttpResponse.BodyHandlers.ofString());
      if(response.statusCode()==401||response.statusCode()==403) throw new BackendException("EASYV_ACTION_FORBIDDEN","EasyV 拒绝本次编辑身份或接口凭证。");
      if(response.statusCode()<200||response.statusCode()>=300) throw unavailable(operation,"HTTP "+response.statusCode(),null);
      var envelope=json.readTree(response.body());
      if(!envelope.path("success").asBoolean()) {
        int code=envelope.path("code").asInt();
        if(code==2015||code==401||code==403)throw new BackendException("EASYV_ACTION_FORBIDDEN","EasyV 拒绝当前业务身份的编辑权限。");
        if(code==400)throw new BackendException("EASYV_ACTION_REJECTED","EasyV 未接受改造："+envelope.path("message").asText("请核对原型现状"));
        throw unavailable(operation,"source code="+code,null);
      }
      if(!envelope.path("data").isObject())throw unavailable(operation,"incomplete response",null);
      return json.convertValue(envelope.get("data"),Map.class);
    } catch(BackendException error){throw error;}
      catch(InterruptedException error){Thread.currentThread().interrupt();throw unavailable(operation,"interrupted",error);}
      catch(Exception error){throw unavailable(operation,error.getClass().getSimpleName(),error);}
  }
  private BackendException unavailable(String operation,String reason,Exception cause){
    log.warn("easyv_block_action_unavailable operation={} reason={}",operation,reason,cause);
    return operation.equals("prepare")
        ?new BackendException("EASYV_ACTION_PREPARE_UNAVAILABLE","未取得 EasyV 改造准备结果,尚未提交保存；请在接口恢复后重新准备。",cause)
        :new BackendException("EASYV_ACTION_RESULT_UNKNOWN","EasyV 保存结果尚未确认,请核查同一方案,不要另建重复操作。",cause);
  }
}
