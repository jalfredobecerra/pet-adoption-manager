module.exports = {
  users: {
    schema: 'User',
    idParam: 'userId',
    projection: 'displayName role shelterId createdAt updatedAt'
  },
  shelters: {
    schema: 'Shelter',
    idParam: 'shelterId'
  },
  pets: {
    schema: 'Pet',
    idParam: 'petId'
  },
  applications: {
    schema: 'Application',
    idParam: 'applicationId'
  }
};