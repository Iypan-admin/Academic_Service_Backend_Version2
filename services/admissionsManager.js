// admissionsManager.js - Real-time Classroom Waiting Room & Admission Control
class AdmissionsManager {
    constructor() {
        // Map<classId, Map<string, { studentId, studentName, regNo, status: 'PENDING'|'APPROVED'|'REJECTED', requestedAt: string }>>
        this.sessions = new Map();
    }

    _getClassMap(classId) {
        const cId = String(classId);
        if (!this.sessions.has(cId)) {
            this.sessions.set(cId, new Map());
        }
        return this.sessions.get(cId);
    }

    requestJoin(classId, studentId, studentName, regNo) {
        const classMap = this._getClassMap(classId);
        const sId = String(studentId);
        if (classMap.has(sId)) {
            const existing = classMap.get(sId);
            // If already approved, remain approved
            if (existing.status === 'APPROVED') {
                return existing;
            }
            // If rejected earlier, let them re-request
            existing.status = 'PENDING';
            existing.requestedAt = new Date().toISOString();
            if (studentName) existing.studentName = studentName;
            if (regNo) existing.regNo = regNo;
            return existing;
        }

        const entry = {
            studentId: sId,
            studentName: studentName || 'Student',
            regNo: regNo || sId,
            status: 'PENDING',
            requestedAt: new Date().toISOString()
        };
        classMap.set(sId, entry);
        return entry;
    }

    getStatus(classId, studentId) {
        const classMap = this._getClassMap(classId);
        const sId = String(studentId);
        if (!classMap || !classMap.has(sId)) {
            return null;
        }
        return classMap.get(sId);
    }

    getPendingRequests(classId) {
        const classMap = this._getClassMap(classId);
        if (!classMap) return [];
        return Array.from(classMap.values()).filter(r => r.status === 'PENDING');
    }

    getAllRequests(classId) {
        const classMap = this._getClassMap(classId);
        if (!classMap) return [];
        return Array.from(classMap.values());
    }

    admitStudent(classId, studentId) {
        const classMap = this._getClassMap(classId);
        const sId = String(studentId);
        if (classMap.has(sId)) {
            const entry = classMap.get(sId);
            entry.status = 'APPROVED';
            entry.admittedAt = new Date().toISOString();
            return entry;
        }
        // If not explicitly requested yet, pre-approve
        const entry = {
            studentId: sId,
            studentName: 'Student',
            regNo: sId,
            status: 'APPROVED',
            requestedAt: new Date().toISOString(),
            admittedAt: new Date().toISOString()
        };
        classMap.set(sId, entry);
        return entry;
    }

    admitAll(classId) {
        const classMap = this._getClassMap(classId);
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
        const sId = String(studentId);
        if (classMap.has(sId)) {
            const entry = classMap.get(sId);
            entry.status = 'REJECTED';
            entry.rejectedAt = new Date().toISOString();
            return entry;
        }
        const entry = {
            studentId: sId,
            status: 'REJECTED',
            rejectedAt: new Date().toISOString()
        };
        classMap.set(sId, entry);
        return entry;
    }

    clearClass(classId) {
        this.sessions.delete(String(classId));
    }
}

module.exports = new AdmissionsManager();
