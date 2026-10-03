// admissionsManager.js - Real-time Classroom Waiting Room & Admission Control
class AdmissionsManager {
    constructor() {
        // Map<classId, Map<studentId, { studentId, studentName, regNo, status: 'PENDING'|'APPROVED'|'REJECTED', requestedAt: string }>>
        this.sessions = new Map();
    }

    _getClassMap(classId) {
        if (!this.sessions.has(classId)) {
            this.sessions.set(classId, new Map());
        }
        return this.sessions.get(classId);
    }

    requestJoin(classId, studentId, studentName, regNo) {
        const classMap = this._getClassMap(classId);
        if (classMap.has(studentId)) {
            const existing = classMap.get(studentId);
            // If already approved, remain approved
            if (existing.status === 'APPROVED') {
                return existing;
            }
            // If rejected earlier, let them re-request
            existing.status = 'PENDING';
            existing.requestedAt = new Date().toISOString();
            return existing;
        }

        const entry = {
            studentId,
            studentName: studentName || 'Student',
            regNo: regNo || studentId,
            status: 'PENDING',
            requestedAt: new Date().toISOString()
        };
        classMap.set(studentId, entry);
        return entry;
    }

    getStatus(classId, studentId) {
        const classMap = this.sessions.get(classId);
        if (!classMap || !classMap.has(studentId)) {
            return null;
        }
        return classMap.get(studentId);
    }

    getPendingRequests(classId) {
        const classMap = this.sessions.get(classId);
        if (!classMap) return [];
        return Array.from(classMap.values()).filter(r => r.status === 'PENDING');
    }

    getAllRequests(classId) {
        const classMap = this.sessions.get(classId);
        if (!classMap) return [];
        return Array.from(classMap.values());
    }

    admitStudent(classId, studentId) {
        const classMap = this._getClassMap(classId);
        if (classMap.has(studentId)) {
            const entry = classMap.get(studentId);
            entry.status = 'APPROVED';
            entry.admittedAt = new Date().toISOString();
            return entry;
        }
        // If not explicitly requested yet, pre-approve
        const entry = {
            studentId,
            studentName: 'Student',
            regNo: studentId,
            status: 'APPROVED',
            requestedAt: new Date().toISOString(),
            admittedAt: new Date().toISOString()
        };
        classMap.set(studentId, entry);
        return entry;
    }

    admitAll(classId) {
        const classMap = this.sessions.get(classId);
        if (!classMap) return 0;
        let count = 0;
        for (const entry of classMap.values()) {
            if (entry.status === 'PENDING') {
                entry.status = 'APPROVED';
                entry.admittedAt = new Date().toISOString();
                count++;
            }
        }
        return count;
    }

    rejectStudent(classId, studentId) {
        const classMap = this._getClassMap(classId);
        if (classMap.has(studentId)) {
            const entry = classMap.get(studentId);
            entry.status = 'REJECTED';
            entry.rejectedAt = new Date().toISOString();
            return entry;
        }
        const entry = {
            studentId,
            status: 'REJECTED',
            rejectedAt: new Date().toISOString()
        };
        classMap.set(studentId, entry);
        return entry;
    }

    clearClass(classId) {
        this.sessions.delete(classId);
    }
}

module.exports = new AdmissionsManager();
