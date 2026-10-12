-- After `local-db.sh sandbox-copy` loads rows with explicit ids (bd-hnhlgn.2): first move every sequence past them —
-- identity columns, serial / nextval() defaults, and text codes built from a sequence ('S-' || nextval(...)),
-- where the number is the code's trailing digits. Without this the first insert reuses a copied id.
do $$
declare r record; m bigint; cur bigint;
begin
  for r in
    select c.oid::regclass as tbl, a.attname as col, a.atttypid,
           coalesce(pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname),
                    substring(pg_get_expr(d.adbin, d.adrelid) from 'nextval\(''([^'']+)''')) as seq
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      and (a.attidentity <> '' or pg_get_expr(d.adbin, d.adrelid) like '%nextval(%')
  loop
    continue when r.seq is null;
    if r.atttypid in ('int2'::regtype, 'int4'::regtype, 'int8'::regtype, 'numeric'::regtype) then
      execute format('select max(%I)::bigint from %s', r.col, r.tbl) into m;
    else
      execute format('select max(substring(%I::text from ''(\d+)$'')::bigint) from %s', r.col, r.tbl) into m;
    end if;
    continue when m is null;
    select coalesce(s.last_value, 0) into cur from pg_sequences s
      where format('%I.%I', s.schemaname, s.sequencename)::regclass = r.seq::regclass;
    perform setval(r.seq::regclass, greatest(m, coalesce(cur, 0)));
  end loop;
end $$;

-- Then the materialized views the portal reads, in passes: one reads another, so refresh what can be refreshed
-- until a pass makes no progress (a plain REFRESH — CONCURRENTLY refuses a never-populated view).
do $$
declare v record; progress boolean := true; pass int := 0;
begin
  while progress and pass < 10 loop
    progress := false; pass := pass + 1;
    for v in select schemaname, matviewname from pg_matviews where schemaname = 'public' and not ispopulated loop
      begin
        execute format('refresh materialized view %I.%I', v.schemaname, v.matviewname);
        progress := true;
      exception when others then null;   -- depends on one not refreshed yet; next pass
      end;
    end loop;
  end loop;
  for v in select matviewname from pg_matviews where schemaname = 'public' and not ispopulated loop
    raise warning 'materialized view % could not be refreshed', v.matviewname;
  end loop;
end $$;
