# Tables are created on the first run; all of them are keyed by the section (BASE_FIELDS)
module Schema
  def self.setup
    create(:votes){ Integer :votes_13; Integer :votes_22 } if LEGACY
    create(:rdv_votes, %i[office]){ Integer :office; column :votes, :jsonb } unless LEGACY # { kind => { number => votes } }
    create(:voting_times, %i[post time]){ String :post; Time :time }
    [VOTES_TABLE, :voting_times].each{ |table| store_in_main table }
  end

  def self.create name, unique = [], &columns
    return if name.in? DB.tables

    DB.create_table name do
      BASE_FIELDS.each{ |f| String f }
      instance_eval(&columns)
      index BASE_FIELDS + unique, unique: true
    end
  end

  def self.store_in_main table
    BASE_FIELDS.each{ |f| DB.execute "alter table #{table} alter column #{f} set storage main" }
  end
end
