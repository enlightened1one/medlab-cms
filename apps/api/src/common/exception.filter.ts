import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');
  catch(ex: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse(); const req = host.switchToHttp().getRequest();
    const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
    let status = HttpStatus.INTERNAL_SERVER_ERROR, code = 'INTERNAL_ERROR', message = 'Something went wrong', details: unknown;

    if (ex instanceof HttpException) {
      status = ex.getStatus(); const b = ex.getResponse() as any;
      code = b?.code ?? HttpStatus[status] ?? 'ERROR';
      message = typeof b === 'string' ? b : (Array.isArray(b?.message) ? 'Validation failed' : b?.message ?? ex.message);
      if (Array.isArray(b?.message)) details = b.message;
    } else if (ex instanceof Prisma.PrismaClientKnownRequestError) {
      if (ex.code === 'P2002') { status = 409; code = 'CONFLICT'; message = 'A record with these details already exists'; }
      else if (ex.code === 'P2025') { status = 404; code = 'NOT_FOUND'; message = 'Record not found'; }
      else if (ex.code === 'P2003') { status = 409; code = 'RELATION_VIOLATION'; message = 'Related record constraint failed'; }
      else if (ex.code === 'P2034') { status = 409; code = 'WRITE_CONFLICT'; message = 'Concurrent update conflict, please retry'; }
      else this.log.error(`prisma ${ex.code} correlationId=${correlationId}`);
    } else if (ex instanceof Prisma.PrismaClientInitializationError || (ex as any)?.code === 'P1001') {
      status = 503; code = 'DATABASE_UNAVAILABLE'; message = 'Service temporarily unavailable';
      this.log.error(`database unavailable correlationId=${correlationId}`);
    } else {
      this.log.error(`unhandled ${(ex as Error)?.name} correlationId=${correlationId}`); // no message/stack to clients
    }
    res.status(status).json({ error: { code, message, details, correlationId } });
  }
}
