import { ComponentListItem } from '../extractors/component.js';
import { logger } from '../utils/logger.js';
import { ParsedFigmaUrl } from '../utils/figma-url.js';

export interface WorkingFile {
  fileId: string;
  fileName?: string;
  url: string;
  setAt: string;
  lastAccessed: string;
  componentCount?: number;
  implementationStatus: Map<string, ComponentImplementationStatus>;
}

export interface ComponentImplementationStatus {
  componentId: string;
  componentName: string;
  status: 'pending' | 'in-progress' | 'implemented' | 'needs-update';
  lastModified?: string;
  implementedAt?: string;
  notes?: string;
  framework?: string;
}

export interface ImplementationQueue {
  pending: ComponentListItem[];
  inProgress: ComponentListItem[];
  implemented: ComponentListItem[];
  needsUpdate: ComponentListItem[];
  total: number;
}

export class SessionManager {
  private sessions = new Map<string, WorkingFile>();
  private readonly SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

  setWorkingFile(clientId: string, parsedUrl: ParsedFigmaUrl, fileName?: string): WorkingFile {
    const now = new Date().toISOString();
    
    const workingFile: WorkingFile = {
      fileId: parsedUrl.fileId,
      fileName: fileName || parsedUrl.fileName,
      url: parsedUrl.url,
      setAt: now,
      lastAccessed: now,
      implementationStatus: new Map(),
    };

    this.sessions.set(clientId, workingFile);
    
    logger.info('Working file set', {
      clientId,
      fileId: parsedUrl.fileId,
      fileName: workingFile.fileName,
      url: parsedUrl.url,
    });

    return workingFile;
  }

  getWorkingFile(clientId: string): WorkingFile | null {
    const session = this.sessions.get(clientId);
    
    if (!session) {
      return null;
    }

    // Check if session has expired
    const now = Date.now();
    const setAt = new Date(session.setAt).getTime();
    
    if (now - setAt > this.SESSION_TTL) {
      this.sessions.delete(clientId);
      logger.info('Session expired', { clientId, fileId: session.fileId });
      return null;
    }

    // Update last accessed
    session.lastAccessed = new Date().toISOString();
    
    return session;
  }

  updateComponentStatus(
    clientId: string, 
    componentId: string, 
    componentName: string,
    status: ComponentImplementationStatus['status'],
    options: {
      notes?: string;
      framework?: string;
    } = {}
  ): boolean {
    const session = this.getWorkingFile(clientId);
    if (!session) {
      return false;
    }

    const now = new Date().toISOString();
    const existing = session.implementationStatus.get(componentId);
    
    const statusUpdate: ComponentImplementationStatus = {
      componentId,
      componentName,
      status,
      lastModified: now,
      notes: options.notes,
      framework: options.framework,
      implementedAt: status === 'implemented' ? now : existing?.implementedAt,
    };

    session.implementationStatus.set(componentId, statusUpdate);
    session.lastAccessed = now;

    logger.info('Component status updated', {
      clientId,
      componentId,
      componentName,
      status,
      framework: options.framework,
    });

    return true;
  }

  getComponentStatus(clientId: string, componentId: string): ComponentImplementationStatus | null {
    const session = this.getWorkingFile(clientId);
    if (!session) {
      return null;
    }

    return session.implementationStatus.get(componentId) || null;
  }

  getImplementationQueue(clientId: string, components: ComponentListItem[]): ImplementationQueue {
    const session = this.getWorkingFile(clientId);
    
    const queue: ImplementationQueue = {
      pending: [],
      inProgress: [],
      implemented: [],
      needsUpdate: [],
      total: components.length,
    };

    for (const component of components) {
      const status = session?.implementationStatus.get(component.id);
      
      if (!status || status.status === 'pending') {
        queue.pending.push(component);
      } else if (status.status === 'in-progress') {
        queue.inProgress.push(component);
      } else if (status.status === 'implemented') {
        queue.implemented.push(component);
      } else if (status.status === 'needs-update') {
        queue.needsUpdate.push(component);
      }
    }

    return queue;
  }

  getImplementationSummary(clientId: string): {
    hasWorkingFile: boolean;
    workingFile?: WorkingFile;
    stats: {
      total: number;
      pending: number;
      inProgress: number;
      implemented: number;
      needsUpdate: number;
      completionPercentage: number;
    };
  } {
    const session = this.getWorkingFile(clientId);
    
    if (!session) {
      return {
        hasWorkingFile: false,
        stats: {
          total: 0,
          pending: 0,
          inProgress: 0,
          implemented: 0,
          needsUpdate: 0,
          completionPercentage: 0,
        },
      };
    }

    const statuses = Array.from(session.implementationStatus.values());
    const stats = {
      total: statuses.length,
      pending: statuses.filter(s => s.status === 'pending').length,
      inProgress: statuses.filter(s => s.status === 'in-progress').length,
      implemented: statuses.filter(s => s.status === 'implemented').length,
      needsUpdate: statuses.filter(s => s.status === 'needs-update').length,
      completionPercentage: statuses.length > 0 
        ? Math.round((statuses.filter(s => s.status === 'implemented').length / statuses.length) * 100)
        : 0,
    };

    return {
      hasWorkingFile: true,
      workingFile: session,
      stats,
    };
  }

  clearWorkingFile(clientId: string): boolean {
    const deleted = this.sessions.delete(clientId);
    
    if (deleted) {
      logger.info('Working file cleared', { clientId });
    }
    
    return deleted;
  }

  // Cleanup expired sessions
  cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [clientId, session] of this.sessions.entries()) {
      const setAt = new Date(session.setAt).getTime();
      
      if (now - setAt > this.SESSION_TTL) {
        this.sessions.delete(clientId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up expired sessions', { count: cleanedCount });
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }
}