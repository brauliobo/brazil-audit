# Reader for the TSE RDV (digital vote record), a BER encoded file.
# Each office is a group holding its code (context tag 1) and the list of votes, each one { kind, number }.
module Rdv
  OFFICE = 0x81
  KIND   = 0x0a
  NUMBER = 0x12
  VOTES  = 0x30

  # { office => { kind => { number => votes } } }, e.g. { 1 => { 2 => { '13' => 75, '22' => 175 }, 3 => { '' => 5 } } }
  def self.votes data
    groups(read data).to_h do |group|
      votes = group.assoc(VOTES).last.map{ |_, vote| [vote.assoc(KIND).last.unpack1('C'), vote.assoc(NUMBER)&.last.to_s] }
      [group.assoc(OFFICE).last.unpack1('C'), votes.group_by(&:first).transform_values{ |vs| vs.map(&:last).tally }]
    end
  end

  def self.groups nodes
    nodes.flat_map do |_, value|
      next [] unless value.is_a? Array
      value.assoc(OFFICE) ? [value] : groups(value)
    end
  end

  # [[tag, value]], where value is the children for constructed tags and the raw bytes otherwise
  def self.read data, from = 0, to = data.bytesize
    nodes = []
    while from < to
      tag, len = data.getbyte(from), data.getbyte(from + 1)
      from += 2
      if len > 0x7f
        size  = len & 0x7f
        len   = data.byteslice(from, size).unpack1('H*').to_i 16
        from += size
      end
      nodes << [tag, tag & 0x20 == 0 ? data.byteslice(from, len) : read(data, from, from + len)]
      from += len
    end
    nodes
  end
end
