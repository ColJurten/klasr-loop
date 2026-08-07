export function planProjectSync(config, event) {
  const { projectId: project, token } = config;
  if (!project || !token) return { action: 'noop', reason: 'project configuration absent' };
  if (!event.issueNodeId || !event.status) return { action: 'noop', reason: 'event identifiers absent' };
  return {
    action: 'graphql',
    query: `query($project:ID!,$cursor:String){node(id:$project){... on ProjectV2{fields(first:100){nodes{... on ProjectV2SingleSelectField{id name options{id name}}}} items(first:100,after:$cursor){nodes{id content{... on Issue{id}}} pageInfo{hasNextPage endCursor}}}}}`,
    variables: { project, cursor: null },
  };
}

const ADD = `mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}`;
const UPDATE = `mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}`;

export async function syncProject(config, event, request) {
  const plan = planProjectSync(config, event);
  if (plan.action === 'noop') return plan;
  try {
    const graphql = request ?? graphqlRequest(config.token);
    let data = await graphql(plan.query, plan.variables);
    const project = data?.node;
    const field = project?.fields?.nodes?.find((candidate) => candidate?.name === 'Status');
    const option = field?.options?.find((candidate) => candidate.name === event.status);
    if (!field || !option) return { action: 'error', reason: 'configured project has no matching Status option' };
    let item = project.items?.nodes?.find((candidate) => candidate.content?.id === event.issueNodeId);
    while (!item && data?.node?.items?.pageInfo?.hasNextPage) {
      data = await graphql(plan.query, { project: config.projectId, cursor: data.node.items.pageInfo.endCursor });
      item = data?.node?.items?.nodes?.find((candidate) => candidate.content?.id === event.issueNodeId);
    }
    if (!item) item = (await graphql(ADD, { project: config.projectId, content: event.issueNodeId }))?.addProjectV2ItemById?.item;
    if (!item?.id) return { action: 'error', reason: 'issue could not be added to project' };
    await graphql(UPDATE, { project: config.projectId, item: item.id, field: field.id, option: option.id });
    return { action: 'updated', itemId: item.id, optionId: option.id };
  } catch {
    return { action: 'error', reason: 'project sync unavailable' };
  }
}

function graphqlRequest(token) {
  return async (query, variables) => {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST', headers: { authorization: `bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const body = await response.json();
    if (!response.ok || body.errors) throw new Error('GraphQL request failed');
    return body.data;
  };
}
