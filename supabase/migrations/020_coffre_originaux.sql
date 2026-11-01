-- Le coffre conserve desormais les photos originales, sans recompression.
-- 30 Mo couvre les photos haute resolution des telephones recents et les PDF.
update storage.buckets
set file_size_limit = 31457280
where id = 'vault';
