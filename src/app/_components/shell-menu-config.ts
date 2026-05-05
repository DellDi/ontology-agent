export type ShellMenuItem = {
  href: string;
  label: string;
  /** URL segment prefix used for active-state matching, e.g. "/admin/ontology" */
  activePrefix: string;
};

export const WORKSPACE_MENU: ShellMenuItem[] = [
  { href: '/workspace', label: '分析首页', activePrefix: '/workspace' },
  { href: '/admin/ontology', label: '本体治理', activePrefix: '/admin' },
];

export const ADMIN_MENU: ShellMenuItem[] = [
  { href: '/workspace', label: '← 返回工作台', activePrefix: '/workspace' },
  { href: '/admin/ontology', label: '概览', activePrefix: '/admin/ontology' },
  {
    href: '/admin/ontology/definitions',
    label: '本体定义',
    activePrefix: '/admin/ontology/definitions',
  },
  {
    href: '/admin/ontology/change-requests',
    label: '变更申请',
    activePrefix: '/admin/ontology/change-requests',
  },
  {
    href: '/admin/ontology/publishes',
    label: '发布记录',
    activePrefix: '/admin/ontology/publishes',
  },
];
