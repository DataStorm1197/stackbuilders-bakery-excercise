import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from './jwt-auth.guard';

const mockExecutionContext = (): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({}) }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn() } },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
    reflector = module.get(Reflector);
  });

  it('returns true immediately for routes marked @Public()', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    const result = await Promise.resolve(guard.canActivate(mockExecutionContext()));

    expect(result).toBe(true);
  });

  it('delegates to passport JWT strategy for protected routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    const parentSpy = jest
      .spyOn(AuthGuard('jwt').prototype as { canActivate: (ctx: ExecutionContext) => Promise<boolean> }, 'canActivate')
      .mockResolvedValue(true);

    const ctx = mockExecutionContext();
    await guard.canActivate(ctx);

    expect(parentSpy).toHaveBeenCalledWith(ctx);
  });
});
