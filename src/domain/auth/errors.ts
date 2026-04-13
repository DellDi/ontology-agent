export class InvalidErpCredentialsError extends Error {
  constructor(message = 'ERP 身份校验失败，请检查账号与组织范围后重试。') {
    super(message);
    this.name = 'InvalidErpCredentialsError';
  }
}

export class WorkspaceAuthorizationError extends Error {
  constructor(
    message = '当前账号暂无可用分析权限，请联系管理员开通项目范围。',
  ) {
    super(message);
    this.name = 'WorkspaceAuthorizationError';
  }
}

export class DevErpAuthDisabledError extends Error {
  constructor(
    message = '当前环境未开放开发联调登录入口，请改用真实 ERP 登录流程或显式开启开发认证开关。',
  ) {
    super(message);
    this.name = 'DevErpAuthDisabledError';
  }
}
