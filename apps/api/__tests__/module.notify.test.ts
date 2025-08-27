jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
jest.mock('undici', () => require('../__mocks__/undici'));

import { prisma } from '../__mocks__/prisma';
import { notify } from '../src/notify';

describe('notify', () => {
  beforeEach(() => {
    (prisma.setting.findFirst as any).mockResolvedValue({ id: 1, notifyType: 'telegram', telegramBot: 'BOT', telegramChatId: 'CHAT' });
  });

  it('sends telegram message when configured', async () => {
    await notify('yandex', 'ok', { a: 1 });
    expect(prisma.setting.findFirst).toHaveBeenCalled();
  });

  it('skips when disabled', async () => {
    (prisma.setting.findFirst as any).mockResolvedValue({ id: 1, notifyType: 'none' });
    await notify('yandex', 'ok', {});
  });
});
