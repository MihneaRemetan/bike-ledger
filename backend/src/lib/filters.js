// Builds the WHERE clause shared by the list endpoints: the user's rows, plus optional bike and date filters.
// `bikeCol` and `dateCol` are SQL expressions chosen by the caller, never user input.
function listFilters(q, userId, { bikeCol, dateCol }) {
  const params = [userId];
  let where = 'b.user_id = $1';
  const add = (sql, value) => {
    params.push(value);
    where += ` AND ${sql.replace('?', `$${params.length}`)}`;
  };
  if (q.bikeId) add(`${bikeCol} = ?`, q.bikeId);
  if (q.from) add(`${dateCol} >= ?::date`, q.from);
  if (q.to) add(`${dateCol} <= ?::date`, q.to);
  return { params, where };
}

module.exports = { listFilters };
