import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Role } from '../enums/role.enum';
import { AuthUser } from '../strategies/jwt.strategy';
import { RolesGuard } from './roles.guard';

const mockContext = (user?: AuthUser): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn() } },
      ],
    }).compile();

    guard = module.get(RolesGuard);
    reflector = module.get(Reflector);
  });

  it('passes when no @Roles() decorator is present', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('passes when the authenticated user holds a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.CUSTOMER]);
    const user: AuthUser = { userId: '1', email: 'a@b.com', role: Role.CUSTOMER };

    expect(guard.canActivate(mockContext(user))).toBe(true);
  });

  it('throws ForbiddenException when the user lacks the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.STORE_MANAGER]);
    const user: AuthUser = { userId: '1', email: 'a@b.com', role: Role.CUSTOMER };

    expect(() => guard.canActivate(mockContext(user))).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when no user is present on the request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.KITCHEN_MANAGER]);

    expect(() => guard.canActivate(mockContext())).toThrow(ForbiddenException);
  });
});
