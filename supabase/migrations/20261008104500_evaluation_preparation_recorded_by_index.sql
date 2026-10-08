-- Keep the author foreign key indexed without changing signed or append-only records.
create index if not exists evaluation_preparation_recorded_by_idx
  on private.evaluation_preparation_versions (recorded_by);
