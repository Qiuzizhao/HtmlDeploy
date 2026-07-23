function createStudentsRepository(store) {
  return {
    list(filters) { return store.listStudents(filters); },
    get(id) { return store.getStudent(id); },
    create(student) { return store.createStudent(student); },
    update(id, changes) { return store.updateStudent(id, changes); },
    importMany(input) { return store.importStudents(input); },
    deleteMany(ids) { return store.deleteStudents(ids); },
    countByClass(classId) { return store.countStudentsByClass(classId); }
  };
}

module.exports = { createStudentsRepository };
