package com.dip3.ontologyagent.easyv.internal.adapter.out.postgres;
import com.dip3.ontologyagent.easyv.internal.application.EasyVBlockActionStore;
import com.dip3.ontologyagent.support.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import java.sql.*;
import java.util.*;
@Repository
@ConditionalOnProperty(prefix="dip3.easyv",name="enabled",havingValue="true")
public class EasyVBlockActionPostgresStore implements EasyVBlockActionStore {
  private final JdbcTemplate jdbc; private final JsonCodec json;
  public EasyVBlockActionPostgresStore(JdbcTemplate jdbc,JsonCodec json){this.jdbc=jdbc;this.json=json;}
  public Action create(String session,String invocation,String owner,Map<String,Object> prepared){
    String id=UUID.randomUUID().toString();
    jdbc.update("insert into platform.easyv_block_actions(id,session_id,invocation_id,owner_user_id,status,prepared) values (?,?,?,?,'prepared',?::jsonb)",id,session,invocation,owner,json.write(prepared));
    return require(id,session,owner);
  }
  public Optional<Action> latest(String session,String invocation,String owner){
    return jdbc.query("select * from platform.easyv_block_actions where session_id=? and invocation_id=? and owner_user_id=? order by created_at desc,id desc limit 1",this::row,session,invocation,owner).stream().findFirst();
  }
  public Action require(String id,String session,String owner){
    return jdbc.query("select * from platform.easyv_block_actions where id=? and session_id=? and owner_user_id=?",this::row,id,session,owner).stream().findFirst()
      .orElseThrow(()->new BackendException("BLOCK_ACTION_NOT_FOUND","改造记录不存在或无权访问。"));
  }
  public boolean claim(String id){
    return jdbc.update("""
      update platform.easyv_block_actions set status='applying',confirmed_at=coalesce(confirmed_at,now()),updated_at=now(),error_message=null,
      history=history || jsonb_build_object('status','applying','at',now())
      where id=? and (status in ('prepared','unknown','context_pending') or (status='applying' and updated_at < now()-interval '60 seconds'))
      """,id)==1;
  }
  public void finish(String id,String status,Map<String,Object> result,String error){
    if(jdbc.update("update platform.easyv_block_actions set status=?,result=?::jsonb,error_message=?,updated_at=now(),history=history || jsonb_build_object('status',?::text,'at',now(),'error',?::text) where id=? and status='applying'",status,json.write(result),error,status,error,id)!=1)
      throw new BackendException("BLOCK_ACTION_STATE_CONFLICT","改造结果状态冲突,请核查已保存结果。");
  }
  private Action row(ResultSet rs,int n)throws SQLException{
    return new Action(rs.getString("id"),rs.getString("session_id"),rs.getString("invocation_id"),rs.getString("owner_user_id"),rs.getString("status"),json.map(rs.getString("prepared")),json.map(rs.getString("result")),rs.getString("error_message"),rs.getTimestamp("updated_at").toInstant());
  }
}
