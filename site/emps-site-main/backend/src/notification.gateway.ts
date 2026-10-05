import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Development outbox. An email provider can implement this contract without changing station workflows.
@Injectable()
export class NotificationGateway {
  async send(kind:'station-review'|'station-invite', payload:unknown) {
    const root=resolve(process.env.NOTIFICATION_OUTBOX_DIR??'reports/notification-outbox');
    await mkdir(root,{recursive:true});
    const id=randomUUID();
    await writeFile(join(root,id+'.json'),JSON.stringify({id,kind,createdAt:new Date(),payload},null,2),{flag:'wx',mode:0o600});
    return {id,delivery:'LOCAL_OUTBOX',sentEmail:false};
  }
}
