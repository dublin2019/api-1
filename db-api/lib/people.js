const LogEntry = require('./types/logentry');
const Person = require('./types/person');

module.exports = { getPublicPeople, getPublicStats, getSinglePerson, addPerson };

function getPublicPeople(req, res, next) {
  req.app.locals.db.any(`SELECT country, membership,
      concat_ws(' ', public_first_name, public_last_name) AS public_name
      FROM People WHERE membership != 'NonMember' AND (public_first_name != '' OR public_last_name != '')
      ORDER BY public_last_name, public_first_name, country`)
    .then(data => {
      res.status(200).json({ status: 'success', data });
    })
    .catch(err => next(err));
}

function getPublicStats(req, res, next) {
  req.app.locals.db.any(`SELECT country, membership, COUNT(*)
      FROM People WHERE membership != 'NonMember'
      GROUP BY CUBE(country, membership)`)
    .then(data => {
      const members = data.reduce((stats, d) => {
        const c = d.country || '';
        const m = d.membership || 'total'
        if (!stats[c]) stats[c] = {};
        stats[c][m] = parseInt(d.count);
        return stats;
      }, {});
      res.status(200).json({ status: 'success', members });
    })
    .catch(err => next(err));
}

function getSinglePerson(req, res, next) {
  const id = parseInt(req.params.id);
  req.app.locals.db.task(t => t.batch([
    t.one('SELECT * FROM People WHERE id = $1', id),
    t.oneOrNone('SELECT name, address, country FROM PaperPubs WHERE people_id = $1', id)
  ]))
    .then(data => {
      const user = req.session.user;
      const person = data[0];
      if (user.member_admin || user.email === person.email) {
        person.paper_pubs = data[1];
        res.status(200).json(person);
      } else {
        res.status(401).json({ status: 'error' });
      }
    })
    .catch(err => next(err));
}

function addPerson(req, res, next) {
  try {
    var log = new LogEntry(req, null, 'Add new person');
    var person = new Person(req.body);
  } catch (e) {
    next({ message: e.message, err: e, log });
  }
  req.app.locals.db.tx(tx => tx.sequence((index, data) => { switch (index) {
    case 0:
      return tx.one(`INSERT INTO People ${person.sqlValues} RETURNING id`, person.data);
    case 1:
      log.subject = parseInt(data.id);
      return tx.none(`INSERT INTO Transactions ${LogEntry.sqlValues}`, log);
  }}))
  .then(() => {
    res.status(200)
      .json({
        status: 'success',
        message: 'Added one person',
        id: log.subject
      });
  })
  .catch(err => next(err));
}
