export const request = jest.fn(async (url: string, init?: any) => {
  const bodyText = JSON.stringify({ ok: true, url, method: (init?.method || 'GET') });
  return {
    statusCode: 200,
    body: { text: async () => bodyText }
  } as any;
});
