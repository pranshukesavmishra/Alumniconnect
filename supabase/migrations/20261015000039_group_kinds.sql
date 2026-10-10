-- Two new kinds of group: the single official group and one group per department (a new enum value can only be used in a later migration).
alter type public.group_kind add value if not exists 'official';
alter type public.group_kind add value if not exists 'department';
