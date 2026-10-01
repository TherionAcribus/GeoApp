"""Lecture du `geocache_visits.txt` des GPS Garmin (module pur, sans base)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from gc_backend.services.garmin_visits import (
    VisitRecord,
    decode_visits_file,
    local_day,
    local_midnight_utc,
    normalize_code,
    occurrence_keys,
    parse_visits,
    reduce_by_cache_day,
)

# Heure d'été de Paris, fixe : les tests ne dépendent pas du fuseau de la machine.
CEST = timezone(timedelta(hours=2))

SAMPLE = (
    'GC3E6GR,2012-11-30T18:23Z,Found it,""\r\n'
    'GC62VNM,2019-12-29T12:05Z,Didn\'t find it,"\r\n\r\n\r\n\r\nMMM\r\nA"\r\n'
    ',2020-08-16T09:52Z,Found it,""\r\n'
    ',2020-08-16T09:52Z,Found it,""\r\n'
    '8,2017-08-27T15:54Z,Found it,""\r\n'
    '\x03,2019-04-14T14:45Z,Found it,""\r\n'
    'GC123AB,2026-09-27T08:06Z,Write note,"Il a dit ""bonjour"""\r\n'
)


def _utf16(text: str, bom: bool = False) -> bytes:
    data = text.encode('utf-16-le')
    return (b'\xff\xfe' + data) if bom else data


def test_decodes_utf16_without_bom():
    assert decode_visits_file(_utf16('GC1,2020-01-01T10:00Z,Found it,""')).startswith('GC1,')


def test_decodes_utf16_with_bom_and_utf8():
    assert decode_visits_file(_utf16('GC1,x', bom=True)) == 'GC1,x'
    assert decode_visits_file('GC1,é'.encode('utf-8')) == 'GC1,é'
    assert decode_visits_file('﻿GC1'.encode('utf-8')) == 'GC1'


def test_parses_real_shapes():
    result = parse_visits(_utf16(SAMPLE))
    assert result.unreadable == []
    assert len(result.visits) == 7

    multiline = next(v for v in result.visits if v.raw_code == 'GC62VNM')
    assert multiline.status == 'dnf'
    assert multiline.comment == 'MMM\nA'

    quoted = next(v for v in result.visits if v.raw_code == 'GC123AB')
    assert quoted.comment == 'Il a dit "bonjour"'
    assert quoted.status == 'other'
    assert quoted.visited_at == datetime(2026, 9, 27, 8, 6, tzinfo=timezone.utc)

    without_code = [v for v in result.visits if v.gc_code is None]
    assert {v.raw_code for v in without_code} == {'', '8'}
    assert len(without_code) == 4


def test_visits_are_sorted_chronologically():
    result = parse_visits(_utf16(SAMPLE))
    times = [v.visited_at for v in result.visits]
    assert times == sorted(times)


def test_normalize_code():
    assert normalize_code(' gc4nkay ') == 'GC4NKAY'
    assert normalize_code('\x04GC12') == 'GC12'
    assert normalize_code('8') is None
    assert normalize_code('#') is None
    assert normalize_code('') is None


def test_unreadable_lines_are_reported():
    result = parse_visits(_utf16('GC1,pas une date,Found it,""\r\nGC2,2020-01-01T10:00Z,Found it,""\r\n'))
    assert len(result.visits) == 1
    assert result.unreadable[0][0] == 1


def test_identical_lines_get_distinct_occurrences():
    result = parse_visits(_utf16(SAMPLE))
    keys = occurrence_keys(result.visits)
    assert len(set(keys)) == len(keys)
    empty = [k for k in keys if k[0] == '' and k[1] == datetime(2020, 8, 16, 9, 52)]
    assert sorted(k[3] for k in empty) == [0, 1]


def _record(i, code, hhmm, status, comment='', day=date(2015, 5, 10)):
    hour, minute = (int(x) for x in hhmm.split(':'))
    return VisitRecord(i, code, datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc),
                       status, status, comment)


def test_reduces_gc4nkay_to_a_single_find():
    records = [
        _record(1, 'GC4NKAY', '11:38', 'unattempted'),
        _record(2, 'GC4NKAY', '11:39', 'unattempted'),
        _record(3, 'GC4NKAY', '11:42', 'dnf'),
        _record(4, 'GC4NKAY', '11:45', 'found'),
    ]
    [reduced] = reduce_by_cache_day(records, CEST)
    assert reduced.status == 'found'
    assert reduced.local_time == '13:45'
    assert reduced.raw_count == 4
    assert reduced.visit_ids == [1, 2, 3, 4]
    assert reduced.proposed_log_type == 'found'
    assert not reduced.has_nm


def test_nm_without_find_needs_confirmation():
    [alone] = reduce_by_cache_day([_record(1, 'GC1', '10:00', 'needs_maintenance')], CEST)
    assert alone.needs_confirmation and alone.has_nm
    assert alone.proposed_log_type == 'found'

    [with_find] = reduce_by_cache_day([
        _record(1, 'GC1', '10:00', 'needs_maintenance'),
        _record(2, 'GC1', '10:05', 'found'),
    ], CEST)
    assert with_find.has_nm and not with_find.needs_confirmation


def test_unattempted_is_skipped():
    [reduced] = reduce_by_cache_day([_record(1, 'GC1', '10:00', 'unattempted')], CEST)
    assert reduced.proposed_log_type == 'skip'


def test_visits_without_code_are_never_merged():
    reduced = reduce_by_cache_day([
        _record(1, None, '09:52', 'found'),
        _record(2, None, '09:52', 'found'),
    ], CEST)
    assert len(reduced) == 2


def test_comments_are_concatenated():
    [reduced] = reduce_by_cache_day([
        _record(1, 'GC1', '10:00', 'dnf', 'Horse'),
        _record(2, 'GC1', '10:05', 'found', 'Bien'),
    ], CEST)
    assert reduced.comment == 'Horse / Bien'


def test_late_summer_visit_belongs_to_next_local_day():
    moment = datetime(2026, 7, 14, 22, 30, tzinfo=timezone.utc)
    assert local_day(moment, CEST) == date(2026, 7, 15)
    [reduced] = reduce_by_cache_day([VisitRecord(1, 'GC1', moment, 'found', 'Found it')], CEST)
    assert reduced.day == date(2026, 7, 15)
    assert reduced.local_time == '00:30'


def test_local_midnight_utc():
    assert local_midnight_utc(date(2026, 9, 1), CEST) == datetime(2026, 8, 31, 22, 0)
