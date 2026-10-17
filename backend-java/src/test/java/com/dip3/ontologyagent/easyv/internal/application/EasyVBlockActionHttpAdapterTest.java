package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.easyv.internal.adapter.out.http.EasyVBlockActionHttpAdapter;
import com.dip3.ontologyagent.support.BackendException;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class EasyVBlockActionHttpAdapterTest {
  @Test void sourceFailureBeforeConfirmationDoesNotImplySaveWasSubmitted() throws Exception {
    try(var endpoint=new Endpoint(503,"unavailable")) {
      var error=assertThrows(BackendException.class,()->endpoint.adapter.prepare(Map.of(),"3","4","0"));
      assertEquals("EASYV_ACTION_PREPARE_UNAVAILABLE",error.code());
      assertTrue(error.getMessage().contains("尚未提交保存"));
      assertEquals("EASYV_ACTION_RESULT_UNKNOWN",assertThrows(BackendException.class,()->endpoint.adapter.apply(Map.of(),"3","4","0")).code());
    }
  }
  @Test void malformedResponseAndSourceErrorsRemainExplicit() throws Exception {
    for(String response:new String[]{"not-json","{\"success\":true}","{\"success\":false,\"code\":500}"}) {
      try(var endpoint=new Endpoint(200,response)) {
        assertEquals("EASYV_ACTION_PREPARE_UNAVAILABLE",assertThrows(BackendException.class,()->endpoint.adapter.prepare(Map.of(),"3","4","0")).code());
      }
    }
    try(var endpoint=new Endpoint(200,"{\"success\":false,\"code\":2015}")) {
      assertEquals("EASYV_ACTION_FORBIDDEN",assertThrows(BackendException.class,()->endpoint.adapter.prepare(Map.of(),"3","4","0")).code());
    }
  }
  @Test void formalEnvelopeAndBusinessIdentityReachSource() throws Exception {
    try(var endpoint=new Endpoint(200,"{\"success\":true,\"data\":{\"status\":\"verified\"}}")) {
      assertEquals("verified",endpoint.adapter.apply(Map.of("plan","exact"),"3","4","0").get("status"));
      assertEquals("/ai-agent/tools/screen/blocks/improvement/apply",endpoint.path);
      assertEquals("3/4/0",endpoint.identity);
      assertEquals("{\"plan\":\"exact\"}",endpoint.body);
    }
  }
  private static class Endpoint implements AutoCloseable {
    final HttpServer server;
    final EasyVBlockActionHttpAdapter adapter;
    String path,identity,body;
    Endpoint(int status,String response) throws Exception {
      server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
      server.createContext("/",exchange->{
        path=exchange.getRequestURI().getPath();
        var headers=exchange.getRequestHeaders();
        identity=headers.getFirst("op-user-id")+"/"+headers.getFirst("space-id")+"/"+headers.getFirst("team-id");
        body=new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8);
        var bytes=response.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status,bytes.length);
        try(var output=exchange.getResponseBody()){output.write(bytes);}
      });
      server.start();adapter=new EasyVBlockActionHttpAdapter("http://127.0.0.1:"+server.getAddress().getPort(),"test-only");
    }
    public void close(){server.stop(0);}
  }
}
